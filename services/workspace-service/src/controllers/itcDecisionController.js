const ItcDecisionModel = require('../models/itcDecisionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

// Get all decisions
exports.listDecisions = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const result = await ItcDecisionModel.getAll(workspaceId, req.query, req.query);
        return successResponse(res, result);
    } catch (error) {
        console.error('Error in listDecisions:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Update decision
exports.updateDecision = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const { id } = req.params;
        const decision = await ItcDecisionModel.update(workspaceId, id, req.body);

        if (!decision) {
            return errorResponse(res, 'Decision not found', 404);
        }

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'UPDATE_ITC_DECISION',
            entityType: 'ItcDecision',
            entityId: decision.id,
            details: { decisionId: id },
            req
        });

        return successResponse(res, decision);
    } catch (error) {
        console.error('Error in updateDecision:', error);
        return errorResponse(res, error.message, 500);
    }
};
