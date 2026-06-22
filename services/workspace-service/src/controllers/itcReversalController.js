const ItcReversalModel = require('../models/itcReversalModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

// Get all reversals
exports.listReversals = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
        }

        const result = await ItcReversalModel.getAll(workspaceId, req.query, req.query);
        return successResponse(res, result);
    } catch (error) {
        console.error('Error in listReversals:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Reclaim reversal
exports.reclaimReversal = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
        }

        const { id } = req.params;
        const {
            reclaim_date,
            reclaim_amount,
            payment_proof_document_id,
            notes
        } = req.body;

        if (!reclaim_date) {
            return errorResponse(res, 'Reclaim date is required', 400);
        }

        const reversal = await ItcReversalModel.update(workspaceId, id, {
            reclaim_date,
            reclaim_amount,
            payment_proof_document_id,
            notes
        });

        if (!reversal) {
            return errorResponse(res, 'Reversal not found', 404);
        }

        return successResponse(res, reversal, 'Reversal reclaimed successfully');
    } catch (error) {
        console.error('Error in reclaimReversal:', error);
        return errorResponse(res, error.message, 500);
    }
};
