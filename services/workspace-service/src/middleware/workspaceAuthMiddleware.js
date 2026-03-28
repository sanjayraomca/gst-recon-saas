const knex = require('../../../shared/src/db/connection');
const { errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * Middleware to authorize workspace access.
 * Checks if the authenticated user (req.user.db_id) has access to the workspace_id.
 * workspace_id can be in:
 * 1. Headers: x-workspace-id
 * 2. Params: :id, :workspace_id
 * 3. Body: workspace_id, workspaceId
 */
const authorizeWorkspace = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user || !user.db_id) {
            return errorResponse(res, 'User authentication context missing', 401);
        }

        // 1. Extract Workspace ID from various possible locations
        let workspaceId = 
            req.headers['x-workspace-id'] || 
            req.params.id || 
            req.params.workspace_id || 
            req.query.workspace_id ||
            req.query.workspaceId ||
            req.body.workspace_id || 
            req.body.workspaceId;

        // 1b. If no workspaceId but run_id is present, look it up
        const runId = req.params.run_id || req.query.run_id;
        if (!workspaceId && runId) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(runId)) {
                const run = await knex('reconciliation_runs')
                    .where({ id: runId })
                    .select('workspace_id')
                    .first();
                if (run) {
                    workspaceId = run.workspace_id;
                }
            }
        }

        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required', 400);
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(workspaceId)) {
            return errorResponse(res, 'Invalid Workspace ID format', 400);
        }

        // 2. Check for SUPER_ADMIN bypass (optional but common)
        if (user.role === 'SUPER_ADMIN' || (user.groups && user.groups.includes('super-admin'))) {
            req.workspace_id = workspaceId;
            return next();
        }

        // 3. Verify user exists in workspace_users table for this workspace
        const access = await knex('workspace_users')
            .where({
                workspace_id: workspaceId,
                user_id: user.db_id,
                invitation_status: 'ACTIVE'
            })
            .whereNull('removed_at')
            .first();

        if (!access) {
            console.warn(`[Security] Unauthorized access attempt: User ${user.db_id} tried to access Workspace ${workspaceId}`);
            return errorResponse(res, 'You do not have permission to access this workspace', 403);
        }

        // Attach workspace context for downstream use
        req.workspace_id = workspaceId;
        req.user_workspace_role = access.role;
        
        next();
    } catch (error) {
        console.error('[workspaceAuthMiddleware] Error:', error);
        return errorResponse(res, 'Internal server error during authorization', 500);
    }
};

module.exports = {
    authorizeWorkspace
};
