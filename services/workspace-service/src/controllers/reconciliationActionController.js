const ReconciliationActionModel = require('../models/reconciliationActionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

const takeAction = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user.sub || req.user.id; // From authMiddleware
        const actionData = req.body;

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        // TODO: Verify result belongs to workspace (Model or query constraint)
        const action = await ReconciliationActionModel.createAction(resultId, actionData, userId);

        return successResponse(res, action, 'Action recorded successfully', 201);
    } catch (error) {
        console.error('Error taking action:', error);
        return errorResponse(res, error.message, 500);
    }
};

const getPendingActions = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const actions = await ReconciliationActionModel.getPendingActions(workspaceId, req.query);
        return successResponse(res, actions, 'Pending actions retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    takeAction,
    getPendingActions
};
