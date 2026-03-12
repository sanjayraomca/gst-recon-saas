const ReconciliationActionModel = require('../models/reconciliationActionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const knex = require('../../../shared/src/db/connection');

const takeAction = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user.sub || req.user.id; // From authMiddleware
        const actionData = req.body;

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        // TODO: Verify result belongs to workspace (Model or query constraint)
        const action = await ReconciliationActionModel.createAction(resultId, actionData, userId);

        await logActivity({
            userId,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'RECON_ACTION',
            entityType: 'ReconciliationAction',
            entityId: action.id,
            details: { resultId, type: actionData.action_type },
            req
        });

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

/**
 * Update reconciliation_status for a specific reconciliation result.
 * This records the user's decision (claimed, wrong_entry_portal, etc.) in the DB.
 */
const updateReconStatus = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user?.sub || req.user?.id;
        const tenantId = req.user?.tenant_id;
        const { recon_status } = req.body;

        const VALID_STATUSES = ['pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim'];

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);
        if (!resultId) return errorResponse(res, 'result_id is required', 400);

        // reconciliation_results.id is an INTEGER primary key
        const resultIdInt = parseInt(resultId, 10);
        if (isNaN(resultIdInt)) {
            return errorResponse(res, 'result_id must be a valid integer', 400);
        }

        if (!recon_status) return errorResponse(res, 'recon_status is required', 400);
        if (!VALID_STATUSES.includes(recon_status)) {
            return errorResponse(res, `Invalid recon_status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
        }

        // Fetch the reconciliation result to get invoice IDs
        const reconResult = await knex('reconciliation_results')
            .where({ id: resultIdInt })
            .first();

        if (!reconResult) {
            return errorResponse(res, 'Reconciliation result not found', 404);
        }

        const { purchase_invoice_id, gstr2b_invoice_id } = reconResult;

        // Upsert logic: if a matching record exists, update it; otherwise insert
        // We match by workspace_id + (book_data_id OR gstr_data_id)
        let existing = null;
        if (purchase_invoice_id) {
            existing = await knex('reconciliation_status')
                .where({ workspace_id: workspaceId, book_data_id: purchase_invoice_id })
                .first();
        }
        if (!existing && gstr2b_invoice_id) {
            existing = await knex('reconciliation_status')
                .where({ workspace_id: workspaceId, gstr_data_id: gstr2b_invoice_id })
                .first();
        }

        let statusRecord;
        if (existing) {
            // Update existing record
            const [updated] = await knex('reconciliation_status')
                .where({ id: existing.id })
                .update({
                    recon_status,
                    updated_by: userId || null,
                    updated_date: knex.fn.now()
                })
                .returning('*');
            statusRecord = updated;
        } else {
            // Insert new record
            const [inserted] = await knex('reconciliation_status')
                .insert({
                    workspace_id: workspaceId,
                    tenant_id: tenantId || workspaceId, // fallback if tenant_id missing from token
                    book_data_id: purchase_invoice_id || null,
                    book_data_type: purchase_invoice_id ? 'purchase_voucher' : null,
                    gstr_data_id: gstr2b_invoice_id || null,
                    gstr_type: gstr2b_invoice_id ? 'gstr2b' : null,
                    recon_status,
                    status: 'Active',
                    added_by: userId || null,
                    added_date: knex.fn.now(),
                    updated_by: userId || null,
                    updated_date: knex.fn.now(),
                    extra_info: JSON.stringify({ recon_result_id: resultId })
                })
                .returning('*');
            statusRecord = inserted;
        }

        // ── Also update reconciliation_results.action_status and match_action ──
        await knex('reconciliation_results')
            .where({ id: resultIdInt })
            .update({
                action_status: recon_status,
                match_action: recon_status,
                updated_at: knex.fn.now()
            });

        await logActivity({
            userId,
            tenantId,
            workspaceId,
            actionType: 'RECON_STATUS_UPDATE',
            entityType: 'ReconciliationStatus',
            entityId: statusRecord.id,
            details: { resultId, recon_status },
            req
        });

        return successResponse(res, statusRecord, 'Reconciliation status updated successfully');
    } catch (error) {
        console.error('Error updating reconciliation status:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    takeAction,
    getPendingActions,
    updateReconStatus
};
