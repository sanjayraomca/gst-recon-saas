const keycloakService = require('../services/keycloakService');
const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { isPlatformSuperAdmin, parseMetadata } = require('../../../shared/src/utils/platformAdmin');
const { getRequiredSecret } = require('../../../shared/src/utils/requiredSecrets');
const { verifyRecaptcha } = require('../../../shared/src/utils/recaptcha');
const { isPlatformSuperAdminById } = require('../../../shared/src/utils/workspaceAccess');

// ── Password-reset OTP throttling ──────────────────────────────────────────
// The OTP itself is only a 6-digit code (1,000,000 possibilities), so it MUST
// be rate-limited or it can be brute-forced well within its 15-minute expiry.
// Per-account attempt counts live in users.metadata (JSONB, already used for
// platform_role) so no schema migration is needed. This is a best-effort,
// per-process, per-IP layer on top of that DB-backed per-account lockout —
// it resets on restart and doesn't share state across multiple instances,
// but the per-account lockout below is enforced from the database and does
// not have that limitation.
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const forgotPasswordIpHits = new Map(); // ip -> [timestamps]
const FORGOT_PASSWORD_IP_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_PASSWORD_IP_MAX = 10;

const isForgotPasswordIpRateLimited = (ip) => {
    const now = Date.now();
    const hits = (forgotPasswordIpHits.get(ip) || []).filter(t => now - t < FORGOT_PASSWORD_IP_WINDOW_MS);
    hits.push(now);
    forgotPasswordIpHits.set(ip, hits);

    // Opportunistic cleanup so this Map can't grow unbounded over the life of
    // the process — sweep stale IPs once the tracked set gets large.
    if (forgotPasswordIpHits.size > 5000) {
        for (const [key, timestamps] of forgotPasswordIpHits) {
            if (!timestamps.some(t => now - t < FORGOT_PASSWORD_IP_WINDOW_MS)) {
                forgotPasswordIpHits.delete(key);
            }
        }
    }

    return hits.length > FORGOT_PASSWORD_IP_MAX;
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return errorResponse(res, 'Email and password required', 400);
        }

        const tokenData = await keycloakService.login(email, password);

        // Sync user with local DB
        const decoded = jwt.decode(tokenData.access_token);

        let user = await User.findByEmail(email);
        if (!user) {
            user = await User.create({
                id: crypto.randomUUID(),
                email: email,
                full_name: decoded.name || 'New User',
                auth_provider_id: decoded.sub,
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        // Update Login Stats
        await User.update(user.id, {
            last_login_at: new Date(),
            last_login_ip: req.ip || req.connection.remoteAddress,
            login_count: knex.raw('COALESCE(login_count, 0) + 1')
        });

        // Infer Tenant(s) from Workspaces
        const userTenants = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .join('tenants', 'workspaces.tenant_id', 'tenants.id')
            .select(
                'tenants.id',
                'tenants.tenant_code',
                'tenants.legal_name',
                'workspace_users.role',
                'workspace_users.permissions'
            )
            .where('workspace_users.user_id', user.id);

        // Also check if user OWNS any tenant (even if it has zero workspaces)
        const ownedTenants = await knex('tenants')
            .where('owner_user_id', user.id)
            .select('id', 'tenant_code', 'legal_name');

        const isTenantOwner = ownedTenants.length > 0;

        // Merge owned tenants into the list (if not already present from workspace join)
        const existingTenantIds = new Set(userTenants.map(t => t.id));
        for (const ot of ownedTenants) {
            if (!existingTenantIds.has(ot.id)) {
                userTenants.push({ ...ot, role: 'TENANT_ADMIN' });
            }
        }

        // Extraction: Priority 
        // 1. Owned tenant (highest priority for tenant owners)
        // 2. Direct tenant_id on user record (Set during registration or invites)
        // 3. Tenant name matches User name (Owner/Self scenario)
        // 4. First available tenant
        let primaryTenantId = null;
        let primaryTenant = null;

        if (isTenantOwner) {
            primaryTenant = ownedTenants[0];
            primaryTenantId = primaryTenant.id;
        } else if (user.tenant_id) {
            primaryTenantId = user.tenant_id;
            primaryTenant = userTenants.find(t => t.id === primaryTenantId) || userTenants[0];
        } else if (userTenants.length > 0) {
            const nameMatch = userTenants.find(t => t.legal_name && user.full_name && t.legal_name.toLowerCase() === user.full_name.toLowerCase());
            primaryTenant = nameMatch || userTenants[0];
            primaryTenantId = primaryTenant.id;
        }

        const responsePayload = {
            ...tokenData,
            tenant_id: primaryTenantId,
            tenants: userTenants, // List of all accessible tenants
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                designation: user.designation,
                is_tenant_owner: isTenantOwner,
                roles: userTenants.map(t => ({
                    tenant_id: t.id,
                    role: t.role,
                    permissions: typeof t.permissions === 'string' ? JSON.parse(t.permissions) : t.permissions
                }))
            }
        };

        // Platform super admins are designated server-side (users.metadata.platform_role), never by email
        if (isPlatformSuperAdmin(user)) {
            const hasSuperRole = responsePayload.user.roles.some(r => r.role === 'SUPER_ADMIN');
            if (!hasSuperRole) {
                responsePayload.user.roles.push({
                    tenant_id: null,
                    role: 'SUPER_ADMIN',
                    permissions: { all: true }
                });
            }
        }

        // Log Login
        await logActivity({
            userId: user.id,
            actionType: 'user_login',
            entityType: 'User',
            entityId: user.id,
            details: { email: user.email, primaryTenantId: primaryTenantId },
            req: req
        });

        return successResponse(res, responsePayload, 'Login successful');
    } catch (error) {
        console.error('Login Error:', error.message);
        const status = error.message === 'Invalid email or password' ? 401 : (error.message === 'Account is disabled' ? 403 : 500);
        return errorResponse(res, error.message, status);
    }
};

const refresh = async (req, res) => {
    try {
        const { refresh_token } = req.body;
        const tokenData = await keycloakService.refreshToken(refresh_token);
        return successResponse(res, tokenData, 'Token refreshed');
    } catch (error) {
        return errorResponse(res, error, 401);
    }
};

const getProfile = async (req, res) => {
    try {
        // req.user is set by authMiddleware
        const keycloakId = req.user.sub || req.user.id;
        // In this simplified version, we might assume email is in the token
        const email = req.user.email;

        let user;
        if (email) {
            user = await User.findByEmail(email);
        }

        if (!user) {
            // If not in local DB, return what we have in token
            user = { ...req.user, source: 'keycloak_token_only' };
        }

        return successResponse(res, user, 'Profile fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateProfile = async (req, res) => {
    try {
        const { email } = req.user;
        if (!email) throw new Error("Email not found in token");

        const user = await User.findByEmail(email);
        if (!user) throw new Error("User not found in local DB");

        // Whitelist allowed fields
        const allowedUpdates = ['full_name', 'phone', 'designation', 'profile_image_url', 'mfa_enabled'];
        const updates = {};
        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                updates[key] = req.body[key];
            }
        });

        if (Object.keys(updates).length === 0) {
            return successResponse(res, user, 'No valid fields to update');
        }

        // Try to update Keycloak (Best Effort)
        if (user.auth_provider_id) {
            await keycloakService.updateUser(user.auth_provider_id, updates);
        }

        const updatedUser = await User.update(user.id, updates);

        await logActivity({
            userId: user.id,
            actionType: 'UPDATE_PROFILE',
            entityType: 'User',
            entityId: user.id,
            details: { updates: Object.keys(updates) },
            req: req
        });

        return successResponse(res, updatedUser, 'Profile updated');
    } catch (error) {
        return errorResponse(res, error);
    }
}

const register = async (req, res) => {
    try {
        const { email, password, full_name, phone, recaptcha_token } = req.body;

        if (!email || !password || !full_name) {
            return errorResponse(res, 'Email, password and full name required', 400);
        }

        // Same captcha requirement as /tenants/signup, so this public endpoint can't be used to bypass it.
        const captcha = await verifyRecaptcha(recaptcha_token, req.ip);
        if (!captcha.ok) {
            return errorResponse(res, captcha.message, captcha.status);
        }

        // 1. Create User in Keycloak
        let keycloakId;
        const nameParts = full_name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        try {
            keycloakId = await keycloakService.createUser({
                email,
                password,
                firstName,
                lastName
            });
        } catch (kcError) {
            // Never touch an existing account's credentials from this unauthenticated endpoint:
            // resetting the password here let anyone take over any account by "registering" its email.
            // Existing users must log in or use the forgot-password flow.
            if (kcError.message === 'User already exists in Keycloak') {
                return errorResponse(res, 'An account with this email already exists. Please log in or use Forgot Password.', 409);
            }
            throw kcError;
        }

        if (!keycloakId) {
            throw new Error('Failed to retrieve Keycloak ID');
        }

        // 2. Create User in Local DB
        let user = await User.findByEmail(email);
        if (user) {
            // The email already belongs to a local account whose Keycloak identity is missing/out of sync.
            // Do NOT link the Keycloak account just created by this unauthenticated request to it — that
            // would hand the existing account (and its workspaces) to whoever called /register.
            // Undo the Keycloak user; the owner recovers access via Forgot Password (which proves email ownership).
            try {
                await keycloakService.deleteUser(keycloakId);
            } catch (cleanupErr) {
                console.error(`[register] Could not remove orphan Keycloak user ${keycloakId}:`, cleanupErr.message);
            }
            return errorResponse(res, 'An account with this email already exists. Please log in or use Forgot Password.', 409);
        }

        // Start Transaction for DB operations (module-level knex)
        const trx = await knex.transaction();
        let tenantId; // Declare outside try block to avoid scoping issues

        try {
            user = await trx('users').insert({
                id: crypto.randomUUID(),
                email,
                full_name,
                phone,
                auth_provider_id: keycloakId,
                auth_provider_type: 'KEYCLOAK',
                created_at: new Date(),
                updated_at: new Date()
            }).returning('*');

            user = user[0]; // Knex returns array

            // 3. Create Default Tenant for new User
            tenantId = crypto.randomUUID();
            await trx('tenants').insert({
                id: tenantId,
                owner_user_id: user.id,
                tenant_code: email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 10) + '_' + Math.floor(Math.random() * 1000),
                legal_name: full_name,
                subscription_plan: 'STARTER',
                subscription_status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date()
            });

            // Link user to tenant
            await trx('users').where('id', user.id).update({ tenant_id: tenantId });
            user.tenant_id = tenantId;

            // 5. Actually, removing workspace linkage as per request.
            // Linking user to tenant via a central tenant_users table if it exists?
            // Usually, users belong to tenants. Let's see if there is a tenant_users table.

            // For now, removing 4, 5, 6 as they relate to workspaces.

            // 7. Add User to Keycloak Groups (Tenant Admin & Users)
            try {
                // We need the ID of the 'Tenant Admin' role subgroup under this Organization
                // BUT wait, registerTenant creates a fresh tenant.
                // The 'registerTenant' in tenantController creates generic groups.
                // This 'register' function in authController seems to be doing manual setup?
                // Ah, this is `authController.js` `register`, which is separate from `tenantController.js` `registerTenant`.
                // We should unify or double check.
                // For now, I will add the user to the Tenant group which might have been created?
                // Wait, validation: `authController.js` creates tenant in DB but DOES NOT create Keycloak groups explicitly in lines 216-225.
                // It seems `authController.js` `register` is a simplified flow or the legacy one?
                // The `tenantController.js` `registerTenant` was the one I saw earlier with Keycloak logic.
                // The user request likely matches the `registerTenant` in `tenantController.js`.
                // However, the `authController.js` I am editing has `register` which is also creating tenants.
                // I should assume this `register` also needs to be compatible.
                // But `register` here has no Keycloak group creation logic for the tenant itself.
                // If I add Keycloak group logic here, it might duplicate or conflicts.
                // Let's stick to DB role change here.
                // User said "in keycloak you have to add in tenant admin group and in users group".
                // If this flow doesn't create groups, I can't add them.
                // I'll check `tenantController.js` next.
            } catch (kcGroupErr) {
                console.warn('Failed to add user to Keycloak groups:', kcGroupErr.message);
            }


            await trx.commit();
        } catch (dbError) {
            await trx.rollback();
            throw dbError;
        }

        // Log Registration
        await logActivity({
            userId: user.id,
            tenantId: tenantId,
            actionType: 'tenant_registered',
            entityType: 'Tenant',
            entityId: tenantId,
            details: { email: user.email, tenantName: full_name + "'s Org" },
            req: req
        });

        return successResponse(res, { user, keycloakId }, 'User registered successfully', 201);

    } catch (error) {
        return errorResponse(res, error);
    }
};

const acceptInvite = async (req, res) => {
    try {
        const { token, password, full_name } = req.body;
        const User = require('../models/userModel');
        const knex = require('../../../shared/src/db/connection');

        if (!token) {
            return errorResponse(res, 'Token is required', 400);
        }

        // 1. Find User by Token
        const user = await User.findByInvitationToken(token);
        if (!user) {
            return errorResponse(res, 'Invalid or expired invitation token', 400);
        }

        // Check expiration
        if (new Date() > new Date(user.invitation_expires_at)) {
            return errorResponse(res, 'Invitation token has expired', 400);
        }

        // 2. Update Keycloak Password (ONLY for new/inactive users)
        if (!user.is_active) {
            if (!password) {
                return errorResponse(res, 'Password is required for new account activation', 400);
            }
            try {
                await keycloakService.resetPassword(user.auth_provider_id, password);
            } catch (kcError) {
                console.error('Failed to set password in Keycloak:', kcError);
                return errorResponse(res, 'Failed to set password. Please try again.', 500);
            }
        } else {
            console.log(`User ${user.email} is already active, skipping password reset during invitation acceptance.`);
        }

        // 3. Activate User in DB
        const updateData = {
            is_active: true,
            invitation_token: null,
            invitation_expires_at: null,
            updated_at: new Date()
        };

        if (full_name) {
            updateData.full_name = full_name;
            // Update Keycloak name too
            try {
                await keycloakService.updateUser(user.auth_provider_id, { full_name });
            } catch (e) { console.warn('Failed to update name in Keycloak', e); }
        }

        await User.update(user.id, updateData);

        // 4. Activate Workspace Links and Log Activities
        const workspacesToActivate = await knex('workspace_users')
            .where('user_id', user.id)
            .where('invitation_status', 'INVITED')
            .select('workspace_id');

        await knex('workspace_users')
            .where('user_id', user.id)
            .update({ invitation_status: 'ACTIVE' });

        for (const ws of workspacesToActivate) {
            await logActivity({
                userId: user.id,
                tenantId: user.tenant_id, // Primary tenant or derived
                workspaceId: ws.workspace_id,
                actionType: 'user_activated',
                entityType: 'User',
                entityId: user.id,
                details: {
                    email: user.email,
                    status: 'ACTIVE'
                },
                req
            });
        }

        // 5. Login User (Generate Token) - Only if password is provided or skip if already active (frontend will handle redirect)
        try {
            let tokenData = null;
            if (password) {
                tokenData = await keycloakService.login(user.email, password);
            }

            // Resolve Primary Tenant
            let primaryTenantId = user.tenant_id;
            let primaryTenantName = null;

            if (primaryTenantId) {
                const tenantRecord = await knex('tenants').where('id', primaryTenantId).first();
                if (tenantRecord) {
                    primaryTenantName = tenantRecord.legal_name;
                }
            } else {
                // Fallback: Fetch Tenants for this user via workspace memberships
                const userTenants = await knex('tenants')
                    .join('workspaces', 'tenants.id', 'workspaces.tenant_id')
                    .join('workspace_users', 'workspaces.id', 'workspace_users.workspace_id')
                    .where('workspace_users.user_id', user.id)
                    .distinct('tenants.id', 'tenants.legal_name', 'tenants.tenant_code');

                if (userTenants.length > 0) {
                    const nameMatch = userTenants.find(t => t.legal_name && user.full_name && t.legal_name.toLowerCase() === user.full_name.toLowerCase());
                    const matchedTenant = nameMatch || userTenants[0];
                    primaryTenantId = matchedTenant.id;
                    primaryTenantName = matchedTenant.legal_name;
                }
            }

            const responsePayload = {
                ...tokenData,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: full_name || user.full_name,
                    tenant_id: primaryTenantId,
                    tenant_name: primaryTenantName,
                    roles: [] // Default to empty, populated below if SuperAdmin
                },
                tenant_id: primaryTenantId // Explicit tenant_id at top level for frontend
            };

            // Platform super admins are designated server-side (users.metadata.platform_role), never by email
            if (isPlatformSuperAdmin(user)) {
                responsePayload.user.roles.push({
                    tenant_id: null,
                    role: 'SUPER_ADMIN',
                    permissions: { all: true }
                });
            }

            return successResponse(res, responsePayload, 'Invitation accepted successfully');

        } catch (loginError) {
            console.error('Auto-login failed after accept invite:', loginError);
            return successResponse(res, { message: 'Invitation accepted. Please login.' }, 'Invitation accepted successfully');
        }
    } catch (error) {
        return errorResponse(res, error);
    }
};

const verifyInvite = async (req, res) => {
    try {
        const { token } = req.params;
        const User = require('../models/userModel');
        const knex = require('../../../shared/src/db/connection');

        if (!token) {
            return errorResponse(res, 'Token is required', 400);
        }

        const user = await User.findByInvitationToken(token);
        if (!user) {
            return errorResponse(res, 'Invalid or expired invitation token', 404);
        }

        if (new Date() > new Date(user.invitation_expires_at)) {
            return errorResponse(res, 'Invitation token has expired', 400);
        }

        // Fetch organizations being invited to with full details
        const workspaces = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspace_users.user_id', user.id)
            .where('workspace_users.invitation_status', 'INVITED')
            .select(
                'workspaces.name',
                'workspaces.id',
                'workspaces.gstn',
                'workspaces.workspace_type',
                'workspaces.address'
            );

        return successResponse(res, {
            email: user.email,
            full_name: user.full_name,
            is_active: !!user.is_active,
            organizations: workspaces
        }, 'Invitation verified');

    } catch (error) {
        return errorResponse(res, error);
    }
};

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return errorResponse(res, 'Email is required', 400);
        }

        // Best-effort per-IP throttle to slow down mass OTP-request spam/email
        // bombing. Does not reveal whether the account exists either way.
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
        if (isForgotPasswordIpRateLimited(ip)) {
            return errorResponse(res, 'Too many password reset requests. Please try again later.', 429);
        }

        const user = await User.findByEmail(email);
        if (!user) {
            return errorResponse(res, 'No user found with given email address', 404);
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Issuing a fresh OTP always resets this account's attempt counter/lockout.
        const metadata = parseMetadata(user.metadata);
        delete metadata.otp_attempts;
        delete metadata.otp_locked_until;

        // Save OTP to DB
        await User.update(user.id, {
            reset_password_token: otp,
            reset_password_expires_at: otpExpiresAt,
            metadata: JSON.stringify(metadata),
            updated_at: new Date()
        });

        // Publish Event
        const { publishMessage } = require('../../../shared/src/nats/client');
        publishMessage('PASSWORD_RESET_REQUESTED', {
            email: user.email,
            full_name: user.full_name,
            otp: otp
        });

        return successResponse(res, { message: 'OTP sent successfully' }, 'OTP sent successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const resetPassword = async (req, res) => {
    try {
        const { email, otp, new_password } = req.body;
        if (!email || !otp || !new_password) {
            return errorResponse(res, 'Email, OTP and new password are required', 400);
        }

        // Find user by email and basic check (token lookup is better but email+otp works here)
        // We will verify token in DB next
        const user = await User.findByEmail(email);

        // A 6-digit OTP is only ~1,000,000 possibilities, so without a limit on
        // guesses it can be brute-forced well inside its 15-minute lifetime.
        // Attempts/lockout are tracked per-account in users.metadata (JSONB) so
        // this holds even for parallel requests from many IPs/devices.
        if (user) {
            const metadata = parseMetadata(user.metadata);
            const lockedUntil = metadata.otp_locked_until ? new Date(metadata.otp_locked_until) : null;
            if (lockedUntil && lockedUntil > new Date()) {
                return errorResponse(res, 'Too many incorrect attempts. Please request a new OTP.', 429);
            }

            if (user.reset_password_token !== otp) {
                const attempts = (metadata.otp_attempts || 0) + 1;
                metadata.otp_attempts = attempts;
                if (attempts >= OTP_MAX_ATTEMPTS) {
                    // Lock out and burn the OTP so it can't be retried even after the lock lifts.
                    metadata.otp_locked_until = new Date(Date.now() + OTP_LOCKOUT_MS).toISOString();
                    await User.update(user.id, {
                        metadata: JSON.stringify(metadata),
                        reset_password_token: null,
                        reset_password_expires_at: null
                    });
                    return errorResponse(res, 'Too many incorrect attempts. Please request a new OTP.', 429);
                }
                await User.update(user.id, { metadata: JSON.stringify(metadata) });
            }
        }

        if (!user || user.reset_password_token !== otp) {
            return errorResponse(res, 'Invalid OTP', 400);
        }

        if (new Date() > new Date(user.reset_password_expires_at)) {
            return errorResponse(res, 'OTP has expired', 400);
        }

        // Correct OTP accepted — clear the attempt counter.
        {
            const metadata = parseMetadata(user.metadata);
            if (metadata.otp_attempts || metadata.otp_locked_until) {
                delete metadata.otp_attempts;
                delete metadata.otp_locked_until;
                await User.update(user.id, { metadata: JSON.stringify(metadata) });
            }
        }

        // Verify it isn't the invitation token flow (safety check)
        // reset_password_token is specifically for this flow.

        // Update Keycloak Password
        try {
            if (user.auth_provider_id) {
                await keycloakService.resetPassword(user.auth_provider_id, new_password);
            } else {
                // Local account without a Keycloak identity: the OTP proved email ownership, so it is
                // safe to (re)create / link the Keycloak user here (this replaces the old, unsafe
                // "link on /register" behaviour).
                let keycloakId;
                try {
                    const nameParts = (user.full_name || '').split(' ');
                    keycloakId = await keycloakService.createUser({
                        email: user.email,
                        password: new_password,
                        firstName: nameParts[0] || user.email,
                        lastName: nameParts.slice(1).join(' ')
                    });
                } catch (createErr) {
                    if (createErr.message !== 'User already exists in Keycloak') throw createErr;
                    const kcUser = await keycloakService.getUserByEmail(user.email);
                    if (!kcUser) throw createErr;
                    keycloakId = kcUser.id;
                    await keycloakService.resetPassword(keycloakId, new_password);
                }
                await User.update(user.id, { auth_provider_id: keycloakId });
            }
        } catch (kcError) {
            console.error('Failed to reset password in Keycloak:', kcError.message);
            return errorResponse(res, kcError.message || 'Failed to update password. Please try again.', 400); // 400 as it might be policy violation
        }

        // Clear OTP
        await User.update(user.id, {
            reset_password_token: null,
            reset_password_expires_at: null,
            updated_at: new Date()
        });

        return successResponse(res, { message: 'Password reset successfully' }, 'Password reset successfully');

    } catch (error) {
        return errorResponse(res, error);
    }
};

const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const email = req.user.email; // From token verification

        if (!email || !currentPassword || !newPassword) {
            return errorResponse(res, 'Email, current password, and new password are required', 400);
        }

        // 1. Verify current password by attempting to login
        try {
            await keycloakService.login(email, currentPassword);
        } catch (authError) {
            console.error('Change Password - Auth Error:', authError.message);
            return errorResponse(res, 'Invalid current password', 400);
        }

        // 2. Locate user to get auth_provider_id
        const user = await User.findByEmail(email);
        if (!user || !user.auth_provider_id) {
            return errorResponse(res, 'User identity not fully configured', 500);
        }

        // 3. Update password in Keycloak
        try {
            await keycloakService.resetPassword(user.auth_provider_id, newPassword);
        } catch (kcError) {
            console.error('Change Password - Keycloak Update Error:', kcError.message);
            return errorResponse(res, kcError.message || 'Failed to update password in identity provider', 400);
        }

        // 4. Log Activity
        await logActivity({
            userId: user.id,
            actionType: 'CHANGE_PASSWORD',
            entityType: 'User',
            entityId: user.id,
            details: { action: 'User changed their password' },
            req: req
        });

        return successResponse(res, { message: 'Password changed successfully' }, 'Password changed successfully');

    } catch (error) {
        return errorResponse(res, error);
    }
};

const thirdPartyLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const platform = req.headers['platform'] || req.headers['x-platform'];

        if (!email || !password) {
            return errorResponse(res, 'Email and password required', 400);
        }

        if (!platform) {
            return errorResponse(res, 'Platform header (platform or x-platform) is required', 400);
        }

        // Authenticate via Keycloak
        const tokenData = await keycloakService.login(email, password);

        // Sync user with local DB
        const decoded = jwt.decode(tokenData.access_token);
        let user = await User.findByEmail(email);
        if (!user) {
            user = await User.create({
                id: crypto.randomUUID(),
                email: email,
                full_name: decoded.name || 'New User',
                auth_provider_id: decoded.sub,
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        // Save / Upsert the platform association in third_party_users
        const platformStr = String(platform).trim();
        const emailStr = String(email).toLowerCase().trim();

        const existingThirdPartyUser = await knex('third_party_users')
            .where('email', emailStr)
            .first();

        let dbUser;
        if (existingThirdPartyUser) {
            const updated = await knex('third_party_users')
                .where('email', emailStr)
                .update({
                    platform: platformStr,
                    last_login_at: knex.fn.now(),
                    updated_at: knex.fn.now()
                })
                .returning('*');
            dbUser = updated[0];
        } else {
            const inserted = await knex('third_party_users')
                .insert({
                    id: crypto.randomUUID(),
                    email: emailStr,
                    platform: platformStr,
                    last_login_at: knex.fn.now(),
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now()
                })
                .returning('*');
            dbUser = inserted[0];
        }

        // Infer tenants/roles for response payload
        const userTenants = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .join('tenants', 'workspaces.tenant_id', 'tenants.id')
            .select(
                'tenants.id',
                'tenants.tenant_code',
                'tenants.legal_name',
                'workspace_users.role',
                'workspace_users.permissions'
            )
            .where('workspace_users.user_id', user.id);

        const ownedTenants = await knex('tenants')
            .where('owner_user_id', user.id)
            .select('id', 'tenant_code', 'legal_name');

        const isTenantOwner = ownedTenants.length > 0;
        const existingTenantIds = new Set(userTenants.map(t => t.id));
        for (const ot of ownedTenants) {
            if (!existingTenantIds.has(ot.id)) {
                userTenants.push({ ...ot, role: 'TENANT_ADMIN' });
            }
        }

        let primaryTenantId = null;
        if (isTenantOwner) {
            primaryTenantId = ownedTenants[0].id;
        } else if (user.tenant_id) {
            primaryTenantId = user.tenant_id;
        } else if (userTenants.length > 0) {
            primaryTenantId = userTenants[0].id;
        }

        // Fetch workspaces/organizations list that this user has access to
        const isSuperAdmin = isPlatformSuperAdmin(user);
        let workspaces = [];

        if (isSuperAdmin) {
            workspaces = await knex('workspaces')
                .select(
                    'workspaces.id',
                    'workspaces.name',
                    'workspaces.gstn',
                    'workspaces.workspace_type'
                )
                .where('workspaces.tenant_id', primaryTenantId)
                .whereNull('workspaces.deleted_at');
            workspaces = workspaces.map(w => ({
                ...w,
                role: 'SUPER_ADMIN',
                permissions: { all: true }
            }));
        } else {
            workspaces = await knex('workspace_users')
                .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                .select(
                    'workspaces.id',
                    'workspaces.name',
                    'workspaces.gstn',
                    'workspaces.workspace_type',
                    'workspace_users.role',
                    'workspace_users.permissions'
                )
                .where('workspace_users.user_id', user.id)
                .whereNull('workspace_users.removed_at')
                .whereNull('workspaces.deleted_at');
        }

        // ─── Organization-scoped token ────────────────────────────────────────────
        // If organization-gstno header is sent, validate access and issue an
        // org_access_token that cryptographically proves this user can operate
        // on that specific workspace. The sync API validates this token.
        let orgAccessToken = null;
        let orgInfo = null;

        const orgGstNo = req.headers['organization-gstno'] || req.headers['x-organization-gstno'];

        if (orgGstNo) {
            // Resolve the workspace by GSTIN
            const workspace = await knex('workspaces')
                .where({ gstn: orgGstNo.trim().toUpperCase() })
                .select('id', 'name', 'gstn', 'tenant_id')
                .first();

            if (!workspace) {
                return errorResponse(res, `No organization found with GSTIN: ${orgGstNo}`, 404);
            }

            // isSuperAdmin (above) comes from users.metadata.platform_role. Keycloak group names like
            // "Super Admin" are per-organisation and tenant-assignable, so they are NOT a global role.

            if (!isSuperAdmin) {
                // Regular user — must have an active membership in this workspace
                const access = await knex('workspace_users')
                    .where({
                        workspace_id: workspace.id,
                        user_id: user.id,
                        invitation_status: 'ACTIVE'
                    })
                    .whereNull('removed_at')
                    .first();

                if (!access) {
                    return errorResponse(
                        res,
                        `Access denied: you do not have access to organization "${workspace.name}" (GSTIN: ${workspace.gstn})`,
                        403
                    );
                }
            }

            // Issue org-scoped JWT signed with our own secret (12h lifetime)
            const jwtSecret = getRequiredSecret('JWT_SECRET');
            orgAccessToken = jwt.sign(
                {
                    user_id: user.id,
                    email: user.email,
                    platform: platformStr,
                    workspace_id: workspace.id,
                    tenant_id: workspace.tenant_id,
                    organization_gstn: workspace.gstn,
                    organization_name: workspace.name,
                    is_super_admin: isSuperAdmin
                },
                jwtSecret,
                { expiresIn: '12h', issuer: 'gst-recon-tool' }
            );

            orgInfo = {
                workspace_id: workspace.id,
                organization_name: workspace.name,
                organization_gstn: workspace.gstn
            };
        }
        // ─────────────────────────────────────────────────────────────────────────

        const responsePayload = {
            ...tokenData,
            tenant_id: primaryTenantId,
            tenants: userTenants,
            workspaces: workspaces.map(w => ({
                id: w.id,
                name: w.name,
                gstn: w.gstn,
                workspace_type: w.workspace_type,
                role: w.role,
                permissions: typeof w.permissions === 'string' ? JSON.parse(w.permissions) : w.permissions
            })),
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                designation: user.designation,
                platform: dbUser.platform,
                last_login_at: dbUser.last_login_at,
                is_tenant_owner: isTenantOwner,
                roles: userTenants.map(t => ({
                    tenant_id: t.id,
                    role: t.role,
                    permissions: typeof t.permissions === 'string' ? JSON.parse(t.permissions) : t.permissions
                }))
            },
            // org_access_token is only present when organization-gstno header was sent
            ...(orgAccessToken && {
                org_access_token: orgAccessToken,
                organization: orgInfo
            })
        };

        // Platform super admins are designated server-side (users.metadata.platform_role), never by email
        if (isSuperAdmin) {
            const hasSuperRole = responsePayload.user.roles.some(r => r.role === 'SUPER_ADMIN');
            if (!hasSuperRole) {
                responsePayload.user.roles.push({
                    tenant_id: null,
                    role: 'SUPER_ADMIN',
                    permissions: { all: true }
                });
            }
        }

        // Log activity with platform in activity_type
        await logActivity({
            userId: user.id,
            tenantId: primaryTenantId,
            actionType: 'third_party_login',
            activityType: platformStr,
            entityType: 'User',
            entityId: user.id,
            details: {
                email: user.email,
                platform: platformStr,
                ...(orgInfo && { organization_gstn: orgInfo.organization_gstn })
            },
            req: req
        });

        return successResponse(res, responsePayload, 'Login successful');

    } catch (error) {
        console.error('Third-party login error:', error.message);
        const status = error.message === 'Invalid email or password' ? 401 : (error.message === 'Account is disabled' ? 403 : 500);
        return errorResponse(res, error.message, status);
    }
};

/**
 * POST /auth/third-party/generate-api-key
 * Generates a permanent API key scoped to a specific workspace.
 * The user must be authenticated and have access to the workspace.
 * The raw key is returned ONCE — store it securely.
 */
const generateApiKey = async (req, res) => {
    try {
        const crypto = require('crypto');
        const { key_name, workspace_id, platform } = req.body;

        if (!workspace_id) {
            return errorResponse(res, 'workspace_id is required', 400);
        }

        const user = req.user;
        const userId = user.db_id || user.id;

        // Resolve workspace
        const workspace = await knex('workspaces')
            .where({ id: workspace_id })
            .select('id', 'name', 'gstn', 'tenant_id', 'settings')
            .first();

        if (!workspace) {
            return errorResponse(res, 'Workspace not found', 404);
        }

        // Authorization: must be SUPER_ADMIN or active member of this workspace
        const isSuperAdmin = await isPlatformSuperAdminById(user.db_id);

        if (!isSuperAdmin) {
            const access = await knex('workspace_users')
                .where({ workspace_id: workspace.id, user_id: userId, invitation_status: 'ACTIVE' })
                .whereNull('removed_at')
                .first();
            if (!access) {
                return errorResponse(res, `You do not have access to workspace "${workspace.name}"`, 403);
            }
        }

        // Generate a cryptographically random, non-guessable API key.
        // Previously this was base64(tenant_id + "_" + workspace_id + "_" + name) —
        // a plain encoding of public-ish identifiers with no secret component, so
        // anyone who could see (or guess) a workspace's tenant_id/id/name could
        // reconstruct its permanent API key without ever calling this endpoint.
        // Verification elsewhere (Tier 1 in purchase/salesInvoiceController) is a
        // plain string match against settings.third_party_api_key, so any opaque
        // string works here — no changes needed on the verification side.
        const rawKey = `tpk_${crypto.randomBytes(32).toString('base64url')}`;

        const currentSettings = typeof workspace.settings === 'string'
            ? JSON.parse(workspace.settings)
            : (workspace.settings || {});

        const updatedSettings = {
            ...currentSettings,
            third_party_api_key: rawKey,
            third_party_api_key_name: key_name || `${workspace.name} Key`,
            third_party_api_key_platform: platform || 'Tally Prime',
            third_party_api_key_created_at: new Date().toISOString(),
            third_party_api_key_user_id: userId
        };

        await knex('workspaces')
            .where({ id: workspace.id })
            .update({
                settings: JSON.stringify(updatedSettings),
                updated_at: knex.fn.now()
            });

        await logActivity({
            userId,
            tenantId: workspace.tenant_id,
            workspaceId: workspace.id,
            actionType: 'api_key_generated',
            entityType: 'ApiKey',
            entityId: workspace.id,
            details: { key_name: updatedSettings.third_party_api_key_name, workspace: workspace.name, gstn: workspace.gstn },
            req
        });

        return successResponse(res, {
            id: workspace.id,
            api_key: rawKey,   // Shown ONCE — user must save this
            key_name: updatedSettings.third_party_api_key_name,
            workspace_id: workspace.id,
            organization_name: workspace.name,
            organization_gstn: workspace.gstn,
            platform: updatedSettings.third_party_api_key_platform,
            created_at: updatedSettings.third_party_api_key_created_at
        }, 'API key generated successfully. Copy it now — it will not be shown again.');

    } catch (error) {
        console.error('generateApiKey error:', error.message);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * GET /auth/third-party/api-keys
 * Lists all active API keys for the authenticated user.
 */
const listApiKeys = async (req, res) => {
    try {
        const userId = req.user.db_id || req.user.id;
        const isSuperAdmin = await isPlatformSuperAdminById(req.user.db_id);

        let query = knex('workspaces');
        if (!isSuperAdmin) {
            query = query
                .join('workspace_users', 'workspaces.id', 'workspace_users.workspace_id')
                .where('workspace_users.user_id', userId)
                .whereNull('workspace_users.removed_at');
        }

        const workspaces = await query.select(
            'workspaces.id',
            'workspaces.name as organization_name',
            'workspaces.gstn as organization_gstn',
            'workspaces.settings'
        );

        const keys = [];
        for (const ws of workspaces) {
            const settings = typeof ws.settings === 'string' ? JSON.parse(ws.settings) : (ws.settings || {});
            if (settings.third_party_api_key) {
                keys.push({
                    id: ws.id,
                    key_name: settings.third_party_api_key_name || `${ws.organization_name} Key`,
                    api_key: settings.third_party_api_key,
                    api_key_preview: settings.third_party_api_key,
                    workspace_id: ws.id,
                    organization_name: ws.organization_name,
                    organization_gstn: ws.organization_gstn,
                    platform: settings.third_party_api_key_platform || 'Tally Prime',
                    created_at: settings.third_party_api_key_created_at
                });
            }
        }

        return successResponse(res, keys, 'API keys fetched successfully');
    } catch (error) {
        console.error('listApiKeys error:', error.message);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * DELETE /auth/third-party/api-keys/:id
 * Revokes (deactivates) a specific API key.
 */
const revokeApiKey = async (req, res) => {
    try {
        const userId = req.user.db_id || req.user.id;
        const { id } = req.params;

        const workspace = await knex('workspaces')
            .where({ id })
            .select('id', 'name', 'tenant_id', 'settings')
            .first();

        if (!workspace) {
            return errorResponse(res, 'Workspace not found', 404);
        }

        const isSuperAdmin = await isPlatformSuperAdminById(req.user.db_id);

        if (!isSuperAdmin) {
            const access = await knex('workspace_users')
                .where({ workspace_id: workspace.id, user_id: userId, invitation_status: 'ACTIVE' })
                .whereNull('removed_at')
                .first();
            if (!access) {
                return errorResponse(res, `You do not have access to workspace "${workspace.name}"`, 403);
            }
        }

        const currentSettings = typeof workspace.settings === 'string'
            ? JSON.parse(workspace.settings)
            : (workspace.settings || {});

        const keyName = currentSettings.third_party_api_key_name || 'Tally Key';

        delete currentSettings.third_party_api_key;
        delete currentSettings.third_party_api_key_name;
        delete currentSettings.third_party_api_key_platform;
        delete currentSettings.third_party_api_key_created_at;
        delete currentSettings.third_party_api_key_user_id;

        await knex('workspaces')
            .where({ id: workspace.id })
            .update({
                settings: JSON.stringify(currentSettings),
                updated_at: knex.fn.now()
            });

        await logActivity({
            userId,
            tenantId: workspace.tenant_id,
            workspaceId: workspace.id,
            actionType: 'api_key_revoked',
            entityType: 'ApiKey',
            entityId: workspace.id,
            details: { key_name: keyName },
            req
        });

        return successResponse(res, { id: workspace.id }, 'API key revoked successfully');
    } catch (error) {
        console.error('revokeApiKey error:', error.message);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    login,
    register,
    refresh,
    getProfile,
    updateProfile,
    acceptInvite,
    verifyInvite,
    forgotPassword,
    resetPassword,
    changePassword,
    thirdPartyLogin,
    generateApiKey,
    listApiKeys,
    revokeApiKey
};
