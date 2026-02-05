const Tenant = require('../models/tenantModel');
const keycloakService = require('../services/keycloakService');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

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
        const { email, password, full_name, phone } = req.body;
        const User = require('../models/userModel');

        if (!email || !password || !full_name) {
            return errorResponse(res, 'Email, password and full name required', 400);
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
            const tenantCode = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 10) + '_' + Math.floor(Math.random() * 1000);

            let [tenant] = await trx('tenants').insert({
                id: tenantId,
                tenant_code: tenantCode,
                legal_name: full_name + "'s Org",
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
                permissions: JSON.stringify({
                    can_upload: true,
                    can_reconcile: true,
                    can_override: true,
                    can_export: true,
                    can_invite: true,
                    can_configure: true
                }),
                invitation_status: 'ACTIVE'
            });

            await trx.commit();
            return successResponse(res, { user, tenant }, 'Tenant and user registered successfully', 201);
        } catch (dbError) {
            await trx.rollback();
            throw dbError;
        }
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
    registerTenant
};
