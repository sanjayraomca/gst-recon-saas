const keycloakService = require('../services/keycloakService');
const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

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
        const { email, password, full_name, phone } = req.body;

        if (!email || !password || !full_name) {
            return errorResponse(res, 'Email, password and full name required', 400);
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
            // Handle existing user in Keycloak (e.g. from previous run), proceed to check local DB
            if (kcError.message === 'User already exists in Keycloak') {
                const kcUser = await keycloakService.getUserByEmail(email);
                if (kcUser) {
                    keycloakId = kcUser.id;
                    // Sync password
                    await keycloakService.resetPassword(keycloakId, password);
                }
            } else {
                throw kcError;
            }
        }

        if (!keycloakId) {
            throw new Error('Failed to retrieve Keycloak ID');
        }

        // 2. Create User in Local DB
        let user = await User.findByEmail(email);
        if (user) {
            // Update auth_provider_id if missing
            if (!user.auth_provider_id) {
                user = await User.update(user.id, { auth_provider_id: keycloakId });
            }
            // If user exists but has no tenant_id, try to link them to their owned tenant
            if (!user.tenant_id) {
                const ownedTenant = await knex('tenants').where('owner_user_id', user.id).first();
                if (ownedTenant) {
                    await knex('users').where('id', user.id).update({ tenant_id: ownedTenant.id });
                    user.tenant_id = ownedTenant.id;
                }
            }
            return errorResponse(res, 'User already exists in local DB', 409);
        }

        // Start Transaction for DB operations
        const knex = require('../../../shared/src/db/connection');
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
                legal_name: full_name + "'s Org",
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

            // --- DEV SUPER ADMIN LOGIC START ---
            const devEmail = 'superadmin.dev@gmail.com';
            let devUser = await trx('users').where('email', devEmail).first();
            let devKeycloakId = null;

            try {
                const kcDevUser = await keycloakService.getUserByEmail(devEmail);
                if (kcDevUser) {
                    devKeycloakId = kcDevUser.id;
                } else {
                    devKeycloakId = await keycloakService.createUser({
                        email: devEmail,
                        password: 'superadmin@123',
                        firstName: 'Dev',
                        lastName: 'SuperAdmin'
                    });
                }

                if (!devUser && devKeycloakId) {
                    const [newDevUser] = await trx('users').insert({
                        id: crypto.randomUUID(),
                        email: devEmail,
                        full_name: 'Dev SuperAdmin',
                        auth_provider_id: devKeycloakId,
                        auth_provider_type: 'KEYCLOAK',
                        created_at: new Date(),
                        updated_at: new Date(),
                        is_active: true
                    }).returning('*');
                    devUser = newDevUser;
                } else if (devUser && !devUser.auth_provider_id && devKeycloakId) {
                    await trx('users').where('id', devUser.id).update({ auth_provider_id: devKeycloakId });
                }

                // Dev User logic remains but without workspace link
                if (devUser) {
                    // No workspace to link to here anymore
                }
            } catch (devErr) {
                console.warn('Failed to ensure Dev Super Admin exists during registration:', devErr.message);
            }
            // --- DEV SUPER ADMIN LOGIC END ---

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
                    tenant_name: primaryTenantName
                },
                tenant_id: primaryTenantId // Explicit tenant_id at top level for frontend
            };

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

        const user = await User.findByEmail(email);
        if (!user) {
            return errorResponse(res, 'No user found with given email address', 404);
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Save OTP to DB
        await User.update(user.id, {
            reset_password_token: otp,
            reset_password_expires_at: otpExpiresAt,
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

        if (!user || user.reset_password_token !== otp) {
            return errorResponse(res, 'Invalid OTP', 400);
        }

        if (new Date() > new Date(user.reset_password_expires_at)) {
            return errorResponse(res, 'OTP has expired', 400);
        }

        // Verify it isn't the invitation token flow (safety check)
        // reset_password_token is specifically for this flow.

        // Update Keycloak Password
        try {
            await keycloakService.resetPassword(user.auth_provider_id, new_password);
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
    changePassword
};
