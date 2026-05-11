const ItcDecisionModel = require('../models/itcDecisionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { logAudit } = require('../../../shared/src/utils/auditLogger');

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
        const oldDecision = await ItcDecisionModel.getById(workspaceId, id);
        const decision = await ItcDecisionModel.update(workspaceId, id, req.body);

        if (!decision) {
            return errorResponse(res, 'Decision not found', 404);
        }

        // Log to data-level audit_log table
        await logAudit({
            tableName: 'itc_decisions',
            recordId: decision.id,
            action: 'UPDATE',
            oldValue: oldDecision,
            newValue: decision,
            modifiedBy: req.user?.db_id || req.user?.id
        });

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'UPDATE_ITC_DECISION',
            entityType: 'ItcDecision',
            entityId: decision.id,
            details: { 
                decisionId: id,
                new_decision: decision.decision,
                reason: decision.decision_reason,
                description: `ITC decision updated to ${decision.decision} for this record.${decision.decision_reason ? ' Reason: ' + decision.decision_reason : ''}`
            },
            req
        });

        return successResponse(res, decision);
    } catch (error) {
        console.error('Error in updateDecision:', error);
        return errorResponse(res, error.message, 500);
    }
};
