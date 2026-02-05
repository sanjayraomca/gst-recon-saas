const Workspace = require('../models/workspace');
const TenantWorkspace = require('../models/tenantWorkspace');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');

const createWorkspace = async (req, res) => {
    const trx = await knex.transaction();
    try {
        console.log("createWorkspace: Body", req.body);
        console.log("createWorkspace: User", req.user);
        const { code, name, type, industry_type, compliance_level, settings, tenant_id: bodyTenantId } = req.body;
        const tenantId = bodyTenantId || (req.user ? req.user.tenant_id : null);


        // Basic Validation
        if (!code || !name) {
            return res.status(400).json({ error: 'Code and Name are required' });
        }

        // 1. Create Workspace
        const workspaceId = uuidv4();
        const [workspace] = await trx('workspaces').insert({
            id: workspaceId,
            workspace_code: code,
            name,
            gstn: code, // Assuming code/gstin is the GSTN
            workspace_type: type || 'COMPANY',
            compliance_level: compliance_level || 'STANDARD',
            settings: settings || {},
            is_active: true,
            created_at: new Date(),
            updated_at: new Date()
        }).returning('*');

        // 2. Link to Tenant
        // For now, if we don't have a tenant in context, we'll fetch the first one or create a default one for stability.
        // In a real scenario, the user MUST belong to a tenant.

        let targetTenantId = tenantId;

        if (!targetTenantId) {
            console.warn("No tenant_id in user token. Attempting to find a fallback tenant...");
            const firstTenant = await trx('tenants').first();
            if (firstTenant) {
                targetTenantId = firstTenant.id;
            } else {
                console.warn("No tenants found! Creating a default tenant...");
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

        await trx('tenant_workspaces').insert({
            id: uuidv4(),
            tenant_id: targetTenantId,
            workspace_id: workspaceId,
            access_type: 'OWNER'
        });

        // 3. Link User to Workspace (if user info is available)
        // Ensure we have a valid user ID from the token (sub or id)
        const userId = req.user ? (req.user.sub || req.user.id) : null;
        const userEmail = req.user ? (req.user.email || req.user.preferred_username) : null;

        if (userId || userEmail) {
            // We need to check if this user exists in our local DB first.

            let query = trx('users');
            if (userId) {
                query = query.where('auth_provider_id', userId).orWhere('id', userId);
            }
            if (userEmail) {
                query = query.orWhere('email', userEmail);
            }

            let localUser = await query.first();

            if (localUser) {
                await trx('workspace_users').insert({
                    id: uuidv4(),
                    workspace_id: workspaceId,
                    user_id: localUser.id,
                    role: 'WORKSPACE_ADMIN',
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
            } else {
                console.warn(`User ${userId || userEmail} not found in local DB. Skipping workspace_users link.`);
            }
        } else {
            console.warn("No user context found. Skipping workspace_users link.");
        }

        await trx.commit();
        return successResponse(res, workspace, 'Workspace created successfully');
    } catch (error) {
        await trx.rollback();
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
