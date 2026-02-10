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
    entityType,
    entityId,
    details,
    req
}) => {
    try {
        let ipAddress = null;
        let userAgent = null;

        if (req) {
            ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            userAgent = req.headers['user-agent'];
        }

        await knex('activity_logs').insert({
            user_id: userId || null,
            tenant_id: tenantId || null,
            workspace_id: workspaceId || null,
            action_type: actionType,
            entity_type: entityType,
            entity_id: entityId || null,
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
