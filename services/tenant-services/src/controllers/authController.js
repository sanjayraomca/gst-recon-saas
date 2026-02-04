const keycloakService = require('../services/keycloakService');
const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

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

        return successResponse(res, tokenData, 'Login successful');
    } catch (error) {
        return errorResponse(res, error, 401);
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
                if (kcUser) keycloakId = kcUser.id;
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

module.exports = {
    login,
    register,
    refresh,
    getProfile,
    updateProfile
};
