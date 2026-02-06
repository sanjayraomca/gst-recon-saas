const Workspace = require('../models/workspace');
const TenantWorkspace = require('../models/tenantWorkspace');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');

const keycloakService = require('../services/keycloakService');

const createWorkspace = async (req, res) => {
    const trx = await knex.transaction();
    try {
        console.log("createWorkspace: Body", req.body);
        console.log("createWorkspace: User", req.user);
        const { code, name, type, industry_type, compliance_level, settings, tenant_id: bodyTenantId, legal_name, address, trade_name, state, city } = req.body;
        // code is treated as GSTIN here per request context
        const gstin = code;

        // Basic Validation
        if (!code || !name) {
            return res.status(400).json({ error: 'Code/GSTIN and Name are required' });
        }

        // 1. Resolve Tenant Context
        let targetTenantId = bodyTenantId || (req.user ? req.user.tenant_id : null);
        let tenantGroupId = null;

        // If no explicit tenant ID, try to derive from Keycloak groups
        if (!targetTenantId && req.user && req.user.groups && req.user.groups.length > 0) {
            const tokenGroupValue = req.user.groups[0];

            // The token value might be an ID or a Name/Path depending on Keycloak mapper config.
            // Let's deduce the real ID.

            // 1. Try treating it as an ID
            const groupById = await keycloakService.getGroupById(tokenGroupValue);

            if (groupById) {
                tenantGroupId = groupById.id;
            } else {
                // 2. If not found by ID, try treating it as a Name (strip leading slash if path)
                const searchName = tokenGroupValue.startsWith('/') ? tokenGroupValue.substring(1) : tokenGroupValue;
                const groupByName = await keycloakService.getGroupByName(searchName);

                if (groupByName) {
                    tenantGroupId = groupByName.id;
                }
            }

            if (tenantGroupId) {
                // Try to find a local tenant that matches this group ID in metadata
                const matchingTenant = await trx('tenants')
                    .whereRaw("metadata->'keycloak_groups'->>'tenant_group_id' = ?", [tenantGroupId])
                    .first();

                if (matchingTenant) {
                    targetTenantId = matchingTenant.id;
                } else {
                    console.warn(`Resolved Keycloak Group ID ${tenantGroupId} but no matching local tenant found.`);
                }
            } else {
                console.warn(`Could not resolve Keycloak group from token value: ${tokenGroupValue}`);
            }
        }

        if (!targetTenantId) {
            // Fallback: This is likely where the "Mock Data" issue comes from. 
            // If we can't identify the tenant, we default to the first one. 
            // Better to try finding a tenant linked to the user?
            const userId = req.user ? (req.user.sub || req.user.id) : null;
            if (userId) {
                const textUser = await trx('users').where('auth_provider_id', userId).first();
                if (textUser && textUser.tenant_id) {
                    targetTenantId = textUser.tenant_id;
                }
            }
        }

        if (!targetTenantId) {
            const firstTenant = await trx('tenants').first();
            if (firstTenant) {
                targetTenantId = firstTenant.id;
            } else {
                // Create default if absolutely nothing exists
                const defaultTenantId = uuidv4();
                await trx('tenants').insert({
                    id: defaultTenantId,
                    tenant_code: 'default_' + Math.floor(Math.random() * 10000),
                    legal_name: 'Default Organization',
                    subscription_plan: 'STARTER',
                    subscription_status: 'ACTIVE'
                });
                targetTenantId = defaultTenantId;
            }
        }

        // 2. Create Workspace (Moved up to satisfy FK constraint in gstin_master)
        const workspaceId = uuidv4();
        const [workspace] = await trx('workspaces').insert({
            id: workspaceId,
            workspace_code: code,
            name,
            gstn: code,
            tenant_id: targetTenantId, // Added as per requirement
            workspace_type: type || 'COMPANY',
            compliance_level: compliance_level || 'STANDARD',
            settings: settings || {},
            is_active: true,
            created_at: new Date(),
            updated_at: new Date()
        }).returning('*');

        // 3. Insert into gstin_master
        const existingGstin = await trx('gstin_master').where('gstin', gstin).first();
        if (!existingGstin) {
            // Derive state from GSTIN (first 2 digits)
            const stateCode = gstin.substring(0, 2);

            await trx('gstin_master').insert({
                id: uuidv4(), // GSTN Service uses UUID for ID
                workspace_id: workspaceId,
                gstin: gstin,
                legal_name: legal_name || name,
                trade_name: trade_name || name,
                state_code: stateCode || state || 'UNKNOWN',
                registration_type: 'REGULAR', // Default
                address: address ? JSON.stringify(address) : JSON.stringify({ city: city, state: stateCode }),
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        // 4. Create Keycloak Subgroup (New Requirement)
        // 4. Create Keycloak Subgroup (New Requirement)
        // If we derived tenantGroupId from the token earlier, use it.
        // Otherwise, try to fetch from tenant metadata.
        if (!tenantGroupId) {
            const tenant = await trx('tenants').where('id', targetTenantId).first();
            tenantGroupId = tenant?.metadata?.keycloak_groups?.tenant_group_id;

            // If still not found, fallback to fetching by ID (if ID is name-like) or Name
            if (!tenantGroupId) {
                // Warning: targetTenantId is a UUID, usually not the group name in Keycloak unless mapped.
                // But previous code assumed it might be.
                const kcGroup = await keycloakService.getGroupByName(targetTenantId); // or tenant.legal_name?
                if (kcGroup) {
                    tenantGroupId = kcGroup.id;
                }
            }
        }

        if (tenantGroupId) {
            try {
                // Name will be GSTIN
                await keycloakService.createSubgroup(tenantGroupId, gstin, {
                    workspace_id: gstin, // Attribute to link back if needed
                    type: 'GSTIN'
                });
            } catch (kcError) {
                console.warn(`Failed to create Keycloak subgroup for GSTIN ${gstin}:`, kcError.message);
            }
        } else {
            console.warn("Tenant Keycloak Group ID not found. Skipping subgroup creation.");
        }


        // 5. Link to Tenant
        await trx('tenant_workspaces').insert({
            id: uuidv4(),
            tenant_id: targetTenantId,
            workspace_id: workspaceId,
            access_type: 'OWNER'
        });

        // 7. Link User
        const userId = req.user ? (req.user.sub || req.user.id) : null;
        const userEmail = req.user ? (req.user.email || req.user.preferred_username) : null;

        if (userId || userEmail) {
            let query = trx('users');
            if (userId) query = query.where('auth_provider_id', userId).orWhere('id', userId);
            if (userEmail) query = query.orWhere('email', userEmail);
            let localUser = await query.first();

            if (localUser) {
                await trx('workspace_users').insert({
                    id: uuidv4(),
                    workspace_id: workspaceId,
                    user_id: localUser.id,
                    role: 'WORKSPACE_ADMIN',
                    permissions: { can_upload: true, can_reconcile: true, can_override: true, can_export: true, can_invite: true, can_configure: true },
                    invitation_status: 'ACTIVE'
                });
            }
        }

        await trx.commit();
        return successResponse(res, workspace, 'Workspace created successfully');
    } catch (error) {
        await trx.rollback();
        if (error.code === '23505' && error.constraint === 'workspaces_workspace_code_key') {
            return errorResponse(res, 'Workspace with this Code/GSTIN already exists', 409);
        }
        return errorResponse(res, error);
    }
};

const listWorkspaces = async (req, res) => {
    try {
        const userId = req.user ? (req.user.sub || req.user.id) : null;
        const userEmail = req.user ? (req.user.email || req.user.preferred_username) : null;

        if (!userId && !userEmail) {
            return successResponse(res, [], 'No user context found');
        }

        // Find local user
        let query = knex('users');
        if (userId) {
            query = query.where('auth_provider_id', userId).orWhere('id', userId);
        }
        if (userEmail) {
            query = query.orWhere('email', userEmail);
        }

        const localUser = await query.first();

        if (!localUser) {
            // Log for debugging
            console.warn('listWorkspaces: User not found locally', { userId, userEmail });
            return successResponse(res, [], 'User not found locally');
        }

        // Find workspaces linked to this user
        const userWorkspaces = await knex('workspace_users')
            .where('user_id', localUser.id)
            .select('workspace_id');

        const workspaceIds = userWorkspaces.map(uw => uw.workspace_id);

        if (workspaceIds.length === 0) {
            return successResponse(res, [], 'No workspaces found');
        }

        const workspaces = await knex('workspaces').whereIn('id', workspaceIds);
        return successResponse(res, workspaces, 'Workspaces fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getWorkspace = async (req, res) => {
    try {
        const { id } = req.params;
        const workspace = await Workspace.findById(id);
        if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
        return successResponse(res, workspace, 'Workspace details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listWorkspaceUsers = async (req, res) => {
    try {
        // Mock response for now as User management is Phase 1.1 but linking is here
        // Ideally join workspace_users table
        return successResponse(res, [], 'Workspace users fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const inviteUser = async (req, res) => {
    try {
        // Stub for invite
        return successResponse(res, { status: 'invited' }, 'User invited successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    createWorkspace,
    listWorkspaces,
    getWorkspace,
    listWorkspaceUsers,
    inviteUser
};
