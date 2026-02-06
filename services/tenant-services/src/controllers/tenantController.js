const Tenant = require('../models/tenantModel');
const keycloakService = require('../services/keycloakService');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { publishMessage } = require('../../../shared/src/nats/client');

const createTenant = async (req, res) => {
    try {
        const {
            tenant_code,
            legal_name,
            trading_name,
            pan,
            contact_email,
            contact_phone,
            address,
            subscription_plan = 'STARTER'
        } = req.body;

        // Validation
        if (!tenant_code || !legal_name) {
            return errorResponse(res, 'Tenant code and legal name are required', 400);
        }

        // Check for duplicate tenant code
        const existing = await Tenant.findByCode(tenant_code);
        if (existing) {
            return errorResponse(res, 'Tenant code already exists', 409);
        }

        const tenantId = crypto.randomUUID();

        // Prepare tenant data
        const tenantData = {
            id: tenantId,
            tenant_code,
            legal_name,
            trading_name,
            pan,
            contact_email,
            contact_phone,
            address: address ? JSON.stringify(address) : null,
            subscription_plan,
            subscription_status: 'ACTIVE',
            metadata: {},
            created_at: new Date(),
            updated_at: new Date()
        };

        // Create Keycloak group for tenant using tenant UUID
        let keycloakGroupId = null;
        const groupName = tenantId; // Changed from `tenant_${tenantId}` to just uuid

        try {
            const group = await keycloakService.createGroup(groupName, {
                tenant_id: tenantId,
                tenant_code: tenant_code
            });
            keycloakGroupId = group.id;

            // Optional: If there's a user associated with the request (e.g. from token), add them to group
            if (req.user && req.user.sub) {
                await keycloakService.addUserToGroup(req.user.sub, keycloakGroupId);
            }

            // Store Keycloak group ID in metadata
            tenantData.metadata = {
                keycloak_groups: {
                    tenant_group_id: keycloakGroupId,
                    tenant_group_name: groupName,
                    gstin_groups: {}
                }
            };
        } catch (kcError) {
            console.warn('Failed to create Keycloak group for tenant:', kcError.message);
            // Continue with tenant creation even if Keycloak fails
            tenantData.metadata = {
                keycloak_groups: {
                    tenant_group_id: null,
                    tenant_group_name: groupName,
                    gstin_groups: {},
                    error: kcError.message
                }
            };
        }

        // Create tenant in database
        const tenant = await Tenant.create(tenantData);

        return successResponse(res, {
            tenant,
            keycloak_group_id: keycloakGroupId
        }, 'Tenant created successfully', 201);

    } catch (error) {
        return errorResponse(res, error);
    }
};

const getTenant = async (req, res) => {
    try {
        const { id } = req.params;
        const includeWorkspaces = req.query.include_workspaces === 'true';

        let tenant;
        if (includeWorkspaces) {
            tenant = await Tenant.findWithWorkspaces(id);
        } else {
            tenant = await Tenant.findById(id);
        }

        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        return successResponse(res, tenant, 'Tenant retrieved successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listTenants = async (req, res) => {
    try {
        const filters = {
            subscription_status: req.query.subscription_status,
            subscription_plan: req.query.subscription_plan,
            search: req.query.search
        };

        const pagination = {
            page: req.query.page || 1,
            limit: req.query.limit || 20
        };

        const result = await Tenant.findAll(filters, pagination);

        return successResponse(res, result, 'Tenants retrieved successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateTenant = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Check if tenant exists
        const existing = await Tenant.findById(id);
        if (!existing) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // Whitelist allowed updates
        const allowedFields = [
            'legal_name',
            'trading_name',
            'pan',
            'contact_email',
            'contact_phone',
            'address',
            'subscription_plan',
            'subscription_status'
        ];

        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });

        if (filteredUpdates.address) {
            filteredUpdates.address = JSON.stringify(filteredUpdates.address);
        }

        if (Object.keys(filteredUpdates).length === 0) {
            return errorResponse(res, 'No valid fields to update', 400);
        }

        const tenant = await Tenant.update(id, filteredUpdates);

        return successResponse(res, tenant, 'Tenant updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const deleteTenant = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if tenant exists
        const existing = await Tenant.findById(id);
        if (!existing) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // Check if already inactive
        if (existing.subscription_status === 'INACTIVE') {
            return errorResponse(res, 'Tenant is already inactive', 400);
        }

        // Set subscription_status to INACTIVE (do not delete Keycloak groups)
        const tenant = await Tenant.update(id, {
            subscription_status: 'INACTIVE'
        });

        return successResponse(res, tenant, 'Tenant deactivated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const registerTenant = async (req, res) => {
    try {
        const { email, password, full_name, phone, recaptcha_token } = req.body;
        const User = require('../models/userModel');
        const axios = require('axios'); // Ensure axios is required

        if (!email || !password || !full_name) {
            return errorResponse(res, 'Email, password and full name required', 400);
        }

        // Verify reCAPTCHA
        if (!process.env.RECAPTCHA_SECRET_KEY) {
            console.warn("RECAPTCHA_SECRET_KEY is missing. Skipping verification.");
        } else {
            if (!recaptcha_token) {
                return errorResponse(res, 'reCAPTCHA token is missing', 400);
            }

            try {
                const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptcha_token}`;
                const recaptchaResponse = await axios.post(verificationUrl);

                if (!recaptchaResponse.data.success) {
                    console.error("reCAPTCHA Verification Failed:", recaptchaResponse.data);
                    return errorResponse(res, 'reCAPTCHA verification failed', 400);
                }
            } catch (recaptchaError) {
                console.error("reCAPTCHA Error:", recaptchaError.message);
                return errorResponse(res, 'Failed to verify reCAPTCHA', 500);
            }
        }

        // 1. Create User in Keycloak
        let keycloakId;
        const nameParts = full_name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'User';

        try {
            keycloakId = await keycloakService.createUser({
                email,
                password,
                firstName,
                lastName
            });
        } catch (kcError) {
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

        // 2. Check Local User
        let user = await User.findByEmail(email);
        if (user) {
            return errorResponse(res, 'User already exists', 409);
        }

        // Start Transaction for DB operations
        const knex = require('../../../shared/src/db/connection');
        const trx = await knex.transaction();

        try {
            // Create Local User
            const [newUser] = await trx('users').insert({
                id: crypto.randomUUID(),
                email,
                full_name,
                phone,
                auth_provider_id: keycloakId,
                auth_provider_type: 'KEYCLOAK',
                created_at: new Date(),
                updated_at: new Date()
            }).returning('*');

            user = newUser;

            // 3. Create Tenant
            const tenantId = crypto.randomUUID();

            // Generate Tenant Code: First 3 chars of name + Sequential Number (001, 002...)
            const prefix = full_name.substring(0, 3).toUpperCase();
            const similarTenants = await trx('tenants')
                .where('tenant_code', 'like', `${prefix}%`)
                .count('id as count');

            const nextNum = parseInt(similarTenants[0].count) + 1;
            // Ensure unique loop just in case (optional but safer)
            // For now, relying on count + 1 is 'okay' for low concurrency, 
            // but unique constraint will catch collisions. 
            // Let's rely on count for simplicity as per request.
            const tenantCode = `${prefix}${String(nextNum).padStart(5, '0')}`;

            let [tenant] = await trx('tenants').insert({
                id: tenantId,
                tenant_code: tenantCode,
                legal_name: full_name, // Use same name as signup full_name
                subscription_plan: 'STARTER',
                subscription_status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date()
            }).returning('*');

            // Create Keycloak group for tenant
            const groupName = tenantId; // Changed from `tenant_${tenantId}` to just uuid
            try {
                const group = await keycloakService.createGroup(groupName, {
                    tenant_id: tenantId,
                    tenant_code: tenantCode
                });
                if (group) {
                    // Link user to the new group
                    await keycloakService.addUserToGroup(keycloakId, group.id);

                    const [updatedTenant] = await trx('tenants').where({ id: tenantId }).update({
                        metadata: JSON.stringify({
                            keycloak_groups: {
                                tenant_group_id: group.id,
                                tenant_group_name: groupName,
                                gstin_groups: {}
                            }
                        })
                    }).returning('*');

                    if (updatedTenant) {
                        tenant = updatedTenant;
                        console.log(`Successfully updated metadata for tenant ${tenantId}`);
                    }
                } else {
                    console.warn(`Keycloak group creation returned null for tenant ${tenantId}`);
                }
            } catch (kcGroupError) {
                console.error(`Failed to create Keycloak group during registration for tenant ${tenantId}:`, kcGroupError.message);
            }

            // 4. Create Default Workspace - REMOVED
            // 5. Link Tenant to Workspace - REMOVED
            // 6. Link User to Workspace - REMOVED

            await trx.commit();

            // Publish Event
            publishMessage('TENANT_REGISTERED', {
                email: user.email,
                full_name: user.full_name,
                tenant_code: tenant.tenant_code,
                tenant_id: tenant.id
            });

            return successResponse(res, { user, tenant }, 'Tenant and user registered successfully', 201);
        } catch (dbError) {
            await trx.rollback();
            throw dbError;
        }
    } catch (error) {
        return errorResponse(res, error);
    }
};

const provisionUser = async (req, res) => {
    try {
        const { id: tenantId } = req.params;
        const { email, full_name, phone, role } = req.body;
        const User = require('../models/userModel');

        if (!email || !full_name || !role) {
            return errorResponse(res, 'Email, full name, and role are required', 400);
        }

        // 1. Check Tenant
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // 2. Create/Get User in Keycloak
        let keycloakId;
        const password = crypto.randomUUID().slice(0, 12); // Generate temp password
        const nameParts = full_name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || '';

        try {
            keycloakId = await keycloakService.createUser({
                email,
                password,
                firstName,
                lastName
            });
        } catch (kcError) {
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

        // 3. Add User to Tenant Group in Keycloak
        if (tenant.metadata && tenant.metadata.keycloak_groups && tenant.metadata.keycloak_groups.tenant_group_id) {
            await keycloakService.addUserToGroup(keycloakId, tenant.metadata.keycloak_groups.tenant_group_id);
        } else {
            console.warn(`Tenant ${tenantId} does not have a Keycloak group ID in metadata.`);
            // Fallback: Try to find group by name (UUID)
            const group = await keycloakService.getGroupByName(tenantId);
            if (group) {
                await keycloakService.addUserToGroup(keycloakId, group.id);
            }
        }

        // 4. Create/Update User in Local DB
        let user = await User.findByEmail(email);
        const userData = {
            full_name,
            phone,
            designation: role, // Mapping 'role' from frontend to 'designation'
            auth_provider_id: keycloakId,
            updated_at: new Date()
        };

        if (user) {
            user = await User.update(user.id, userData);
        } else {
            userData.id = crypto.randomUUID();
            userData.email = email;
            userData.auth_provider_type = 'KEYCLOAK';
            userData.created_at = new Date();
            user = await User.create(userData);
        }

        // 5. Link to all tenant workspaces
        const knex = require('../../../shared/src/db/connection');
        const workspaces = await knex('workspaces').where({ tenant_id: tenantId });

        // Map frontend role to workspace role
        // Frontend: super_admin, tenant_admin, org_admin, accountant, viewer
        // Backend Enum: SUPER_ADMIN, WORKSPACE_ADMIN, ACCOUNTANT, AUDITOR, VIEWER, GST_PRACTITIONER
        let workspaceRole = 'VIEWER';
        const roleUpper = role.toUpperCase();

        switch (role) {
            case 'super_admin': workspaceRole = 'SUPER_ADMIN'; break;
            case 'tenant_admin': workspaceRole = 'WORKSPACE_ADMIN'; break;
            case 'org_admin': workspaceRole = 'WORKSPACE_ADMIN'; break;
            case 'accountant': workspaceRole = 'ACCOUNTANT'; break;
            case 'viewer': workspaceRole = 'VIEWER'; break;
            default: workspaceRole = 'VIEWER';
        }

        if (workspaces.length > 0) {
            const workspaceUsers = workspaces.map(ws => ({
                id: crypto.randomUUID(),
                workspace_id: ws.id,
                user_id: user.id,
                role: workspaceRole,
                invitation_status: 'ACTIVE',
                joined_at: new Date()
            }));

            // Use DO NOTHING on conflict to avoid errors if user already exists
            await knex('workspace_users')
                .insert(workspaceUsers)
                .onConflict(['workspace_id', 'user_id'])
                .merge(); // Updates role if exists, or ignore() if we don't want to update
        }

        return successResponse(res, { user, temp_password: password }, 'User provisioned successfully', 201);

    } catch (error) {
        return errorResponse(res, error);
    }
};

const listTenantUsers = async (req, res) => {
    try {
        const { id: tenantId } = req.params;
        const User = require('../models/userModel');

        // 1. Check Tenant
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        let users = [];
        // 2. Get Users from Keycloak Group
        if (tenant.metadata && tenant.metadata.keycloak_groups && tenant.metadata.keycloak_groups.tenant_group_id) {
            const kcUsers = await keycloakService.getGroupMembers(tenant.metadata.keycloak_groups.tenant_group_id);

            // 3. Enrich with Local DB Data (including designation)
            // This is efficient only for small numbers. For large numbers, we should query DB directly.
            // Since we don't have a direct link in DB (yet), we iterate.
            // OPTIMIZATION: In future, add tenant_id to users table or create tenant_users table.

            const emails = kcUsers.map(u => u.email).filter(e => e);
            if (emails.length > 0) {
                // We need a bulk find method, but for now we'll do promise.all or find one by one (inefficient but works for now)
                // Or better: modify userModel to support `whereIn('email', emails)`?
                // Let's stick to simplest: just query all users and filter? No, too heavy.
                // Let's assume we can fetch by email.

                // Actually, let's just assume local DB users is NOT the primary source for "list of tenant users" if we don't link them.
                // But we DO create them in local 'users' table.
                // Let's fetch local user details for each keycloak user.

                users = await Promise.all(kcUsers.map(async (kcu) => {
                    const localUser = await User.findByEmail(kcu.email);
                    return {
                        id: localUser ? localUser.id : kcu.id, // Prefer local ID
                        keycloak_id: kcu.id,
                        email: kcu.email,
                        full_name: localUser ? localUser.full_name : `${kcu.firstName} ${kcu.lastName}`,
                        phone: localUser ? localUser.phone : null,
                        designation: localUser ? localUser.designation : null, // The role/authority vector
                        status: kcu.enabled ? 'active' : 'inactive',
                        created_at: localUser ? localUser.created_at : kcu.createdTimestamp
                    };
                }));
            }
        } else {
            // Fallback if no group ID
            return successResponse(res, [], 'No associated group found for tenant');
        }

        return successResponse(res, users, 'Tenant users retrieved successfully');

    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    createTenant,
    getTenant,
    listTenants,
    updateTenant,
    deleteTenant,
    registerTenant,
    provisionUser,
    listTenantUsers
};
