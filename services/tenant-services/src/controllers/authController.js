const keycloakService = require('../services/keycloakService');
const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');

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
                'workspace_users.role'
            )
            .where('workspace_users.user_id', user.id)
            .distinct('tenants.id');

        // Extract primary tenant
        // Priority:
        // 1. Tenant name matches User name (Owner/Self scenario)
        // 2. First available tenant
        let primaryTenant = null;
        if (userTenants.length > 0) {
            const nameMatch = userTenants.find(t => t.legal_name && user.full_name && t.legal_name.toLowerCase() === user.full_name.toLowerCase());
            primaryTenant = nameMatch || userTenants[0];
        }

        const responsePayload = {
            ...tokenData,
            tenant_id: primaryTenant ? primaryTenant.id : null,
            tenants: userTenants, // List of all accessible tenants
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                roles: userTenants.map(t => ({ tenant_id: t.id, role: t.role }))
            }
        };

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
            return errorResponse(res, 'User already exists in local DB', 409);
        }

        // Start Transaction for DB operations
        const knex = require('../../../shared/src/db/connection');
        const trx = await knex.transaction();

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
            const tenantId = crypto.randomUUID();
            await trx('tenants').insert({
                id: tenantId,
                tenant_code: email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 10) + '_' + Math.floor(Math.random() * 1000),
                legal_name: full_name + "'s Org",
                subscription_plan: 'STARTER',
                subscription_status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date()
            });

            // 4. Create Default Workspace
            const workspaceId = crypto.randomUUID();
            await trx('workspaces').insert({
                id: workspaceId,
                workspace_code: 'WS_' + Math.floor(Math.random() * 10000),
                name: 'Default Workspace',
                workspace_type: 'COMPANY',
                compliance_level: 'STANDARD',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            });

            // 5. Link Tenant to Workspace
            await trx('tenant_workspaces').insert({
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                workspace_id: workspaceId,
                access_type: 'OWNER'
            });

            // 6. Link User to Workspace (as Admin)
            await trx('workspace_users').insert({
                id: crypto.randomUUID(),
                workspace_id: workspaceId,
                user_id: user.id,
                role: 'SUPER_ADMIN',
                permissions: {
                    can_upload: true,
                    can_reconcile: true,
                    can_override: true,
                    can_export: true,
                    can_invite: true,
                    can_configure: true
                },
                invitation_status: 'ACTIVE'
            });

            await trx.commit();
        } catch (dbError) {
            await trx.rollback();
            throw dbError;
        }

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

        if (!token || !password) {
            return errorResponse(res, 'Token and password are required', 400);
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

        // 2. Update Keycloak Password
        try {
            await keycloakService.resetPassword(user.auth_provider_id, password);
        } catch (kcError) {
            console.error('Failed to set password in Keycloak:', kcError);
            return errorResponse(res, 'Failed to set password. Please try again.', 500);
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

        // 4. Activate Workspace Links
        await knex('workspace_users')
            .where('user_id', user.id)
            .update({ invitation_status: 'ACTIVE' });

        // 5. Login User (Generate Token)
        try {
            const tokenData = await keycloakService.login(user.email, password);

            // Fetch Tenants for this user
            const userTenants = await knex('tenants')
                .join('workspaces', 'tenants.id', 'workspaces.tenant_id')
                .join('workspace_users', 'workspaces.id', 'workspace_users.workspace_id')
                .where('workspace_users.user_id', user.id)
                .distinct('tenants.id', 'tenants.legal_name', 'tenants.tenant_code');

            // Prioritize tenant matching user name (using the logic we added earlier)
            let primaryTenant = null;
            if (userTenants.length > 0) {
                const nameMatch = userTenants.find(t => t.legal_name && user.full_name && t.legal_name.toLowerCase() === user.full_name.toLowerCase());
                primaryTenant = nameMatch || userTenants[0];
            }

            const responsePayload = {
                ...tokenData,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: full_name || user.full_name,
                    tenant_id: primaryTenant ? primaryTenant.id : null,
                    tenant_name: primaryTenant ? primaryTenant.legal_name : null
                }
            };

            return successResponse(res, responsePayload, 'Invitation accepted and logged in successfully');

        } catch (loginError) {
            console.error('Auto-login failed after accept invite:', loginError);
            return successResponse(res, { message: 'Invitation accepted. Please login.' }, 'Invitation accepted successfully');
        }

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
            // Return success even if email not found for security
            return successResponse(res, { message: 'If an account exists, an OTP has been sent.' }, 'OTP sent successfully');
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

module.exports = {
    login,
    register,
    refresh,
    getProfile,
    updateProfile,
    acceptInvite,
    forgotPassword,
    resetPassword
};
