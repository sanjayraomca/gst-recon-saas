const ReconciliationActionModel = require('../models/reconciliationActionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const knex = require('../../../shared/src/db/connection');

const takeAction = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        // userId should be the internal UUID (db_id) resolved by authMiddleware
        const userId = req.user.db_id || req.user.sub || req.user.id; 
        const actionData = req.body;

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

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
    const trx = await knex.transaction();
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user.db_id || req.user.sub || req.user.id;
        const { recon_status } = req.body;

        const VALID_STATUSES = ['pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim'];

        if (!workspaceId) {
            await trx.rollback();
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const resultIdInt = parseInt(resultId, 10);
        if (isNaN(resultIdInt)) {
            await trx.rollback();
            return errorResponse(res, 'result_id must be a valid integer', 400);
        }

        if (!recon_status || !VALID_STATUSES.includes(recon_status)) {
            await trx.rollback();
            return errorResponse(res, `Invalid or missing recon_status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
        }

        // 1. Fetch the reconciliation result to get invoice IDs and verify ownership
        const reconResult = await trx('reconciliation_results')
            .where({ id: resultIdInt, workspace_id: workspaceId })
            .first();

        if (!reconResult) {
            await trx.rollback();
            return errorResponse(res, 'Reconciliation result not found for this workspace', 404);
        }

        // 2. Resolve Tenant ID robustly
        let tenantId = req.user?.tenant_id;
        if (!tenantId) {
            const workspace = await trx('workspaces').where({ id: workspaceId }).select('tenant_id').first();
            tenantId = workspace?.tenant_id || workspaceId; 
        }

        const { purchase_invoice_id, gstr2b_invoice_id } = reconResult;

        // 3. Upsert logic for reconciliation_status
        let existing = null;
        if (purchase_invoice_id) {
            existing = await trx('reconciliation_status')
                .where({ workspace_id: workspaceId, book_data_id: purchase_invoice_id })
                .first();
        }
        if (!existing && gstr2b_invoice_id) {
            existing = await trx('reconciliation_status')
                .where({ workspace_id: workspaceId, gstr_data_id: gstr2b_invoice_id })
                .first();
        }

        let statusRecord;
        if (existing) {
            [statusRecord] = await trx('reconciliation_status')
                .where({ id: existing.id })
                .update({
                    recon_status,
                    updated_by: userId || null,
                    updated_date: trx.fn.now()
                })
                .returning('*');
        } else {
            [statusRecord] = await trx('reconciliation_status')
                .insert({
                    workspace_id: workspaceId,
                    tenant_id: tenantId,
                    book_data_id: purchase_invoice_id || null,
                    book_data_type: purchase_invoice_id ? 'purchase_voucher' : null,
                    gstr_data_id: gstr2b_invoice_id || null,
                    gstr_type: gstr2b_invoice_id ? 'gstr2b' : null,
                    recon_status,
                    status: 'Active',
                    added_by: userId || null,
                    added_date: trx.fn.now(),
                    updated_by: userId || null,
                    updated_date: trx.fn.now(),
                    extra_info: { recon_result_id: resultIdInt }
                })
                .returning('*');
        }

        // 4. Update reconciliation_results table directly for fast filtering/UI
        await trx('reconciliation_results')
            .where({ id: resultIdInt })
            .update({
                action_status: recon_status,
                updated_at: trx.fn.now()
            });

        await trx.commit();

        // 5. Async Log Activity (outside transaction)
        logActivity({
            userId,
            tenantId,
            workspaceId,
            actionType: 'RECON_STATUS_UPDATE',
            entityType: 'ReconciliationStatus',
            entityId: statusRecord.id,
            details: { resultId, recon_status },
            req
        }).catch(err => console.error('[ActivityLog] Error:', err));

        return successResponse(res, statusRecord, 'Reconciliation status updated successfully');
    } catch (error) {
        if (trx) await trx.rollback();
        console.error('[updateReconStatus] Critical Error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    takeAction,
    getPendingActions,
    updateReconStatus
};
