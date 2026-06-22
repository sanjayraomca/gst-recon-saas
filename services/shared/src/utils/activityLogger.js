const knex = require('../db/connection');

/**
 * Logs an activity to the database.
 * @param {Object} params - The log parameters.
 * @param {string} params.userId - The ID of the user performing the action (optional).
 * @param {string} params.tenantId - The ID of the tenant (optional).
 * @param {string} params.workspaceId - The ID of the workspace (optional).
 * @param {string} params.actionType - The type of action (e.g., 'LOGIN', 'CREATE').
 * @param {string} params.entityType - The type of entity (e.g., 'User', 'Organization').
 * @param {string} params.entityId - The ID of the entity (optional).
 * @param {Object} params.details - Additional details (JSON).
 * @param {Object} params.req - The Express request object (to extract IP and User Agent).
 */
const logActivity = async ({
    userId,
    tenantId,
    workspaceId,
    actionType,
    activityType,
    entityType,
    entityId,
    details,
    req
}) => {
    // Skip logging read/view actions to prevent database bloat and duplicate logs
    const actionUpper = actionType ? String(actionType).toUpperCase() : '';
    if (actionUpper.startsWith('VIEW_')) {
        return;
    }

    try {
        let ipAddress = null;
        let userAgent = null;

        if (req) {
            ipAddress = (req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress);
            userAgent = req.headers && req.headers['user-agent'];

            // Automatically extract IDs from request context if not provided
            if (req.user) {
                if (!userId) userId = req.user.db_id || req.user.id || req.user.sub;
                if (!tenantId) tenantId = req.user.tenantId || req.user.tenant_id;
                if (!workspaceId) workspaceId = req.user.workspaceId || req.user.workspace_id || (req.headers && req.headers['x-workspace-id']);
            }
        }

        // 1. Resolve valid User UUID
        let validUserId = null;
        if (userId) {
            if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId)) {
                validUserId = userId;
            } else {
                try {
                    const user = await knex('users').where({ auth_provider_id: userId }).first();
                    if (user) {
                        validUserId = user.id;
                    }
                } catch (e) {
                    console.error('Failed to resolve valid user UUID for activity log:', e.message);
                }
            }
        }

        // 2. Resolve missing Tenant ID from Workspace ID if possible
        if (!tenantId && workspaceId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(workspaceId)) {
            try {
                const workspace = await knex('workspaces').where({ id: workspaceId }).select('tenant_id').first();
                if (workspace) {
                    tenantId = workspace.tenant_id;
                }
            } catch (e) {
                console.error('Failed to resolve tenantId from workspaceId:', e.message);
            }
        }

        // 3. Validation Warnings
        if (!validUserId) console.warn(`[ActivityLogger] Missing mandatory USER_ID for action: ${actionType}`);
        if (!tenantId) console.warn(`[ActivityLogger] Missing mandatory TENANT_ID for action: ${actionType}`);
        if (!workspaceId) console.warn(`[ActivityLogger] Missing mandatory WORKSPACE_ID for action: ${actionType}`);

        await knex('activity_logs').insert({
            user_id: validUserId,
            tenant_id: tenantId || null,
            workspace_id: workspaceId || null,
            action_type: actionType,
            activity_type: activityType || null,
            entity_type: entityType,
            entity_id: entityId || workspaceId || null,
            details: details ? JSON.stringify(details) : null,
            ip_address: ipAddress,
            user_agent: userAgent,
            created_at: new Date()
        });

    } catch (error) {
        // We do not want to fail the main request if logging fails, but we should know about it.
        console.error('Failed to log activity:', error);
    }
};

module.exports = { logActivity };
