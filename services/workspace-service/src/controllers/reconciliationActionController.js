const ReconciliationActionModel = require('../models/reconciliationActionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const knex = require('../../../shared/src/db/connection');
const { attachSqlFileLogger } = require('../utils/sqlFileLogger');
const { publishMessage } = require('../../../shared/src/nats/client');
const fs = require('fs');
const path = require('path');

const takeAction = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        // userId should be the internal UUID (db_id) resolved by authMiddleware
        const userId = req.user.db_id || req.user.sub || req.user.id;
        const actionData = req.body;

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const cleanup = attachSqlFileLogger('TakeAction');
        const action = await ReconciliationActionModel.createAction(resultId, actionData, userId);
        cleanup();

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

        const cleanup = attachSqlFileLogger('GetPendingActions');
        const actions = await ReconciliationActionModel.getPendingActions(workspaceId, req.query);
        cleanup();
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
    const cleanup = attachSqlFileLogger('UpdateReconStatus');
    const trx = await knex.transaction();
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user.db_id || req.user.sub || req.user.id;
        const { recon_status, run_type = 'PURCHASE_2B' } = req.body;
        const is2a = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run_type);

        if (is2a) {
            // Drop the legacy check constraint that limits status values
            try {
                await trx.raw(`ALTER TABLE reconciliation_status_gst2a_vs_book DROP CONSTRAINT IF EXISTS chk_recon_status_2a`);
            } catch (e) {
                // Ignore if fails (e.g. permission issues or already dropped)
                console.log('[updateReconStatus] Note: Could not drop constraint chk_recon_status_2a, continuing...');
            }
        }
        const VALID_STATUSES = [
            'pending', 'matched', 'mismatched', 'not_in_books', 'not_in_portal', 'excluded', 
            'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim',
            'claim', 'wrong entry portal', 'not to be claim', 'not eligible'
        ];

        const resultsTable = is2a ? 'reconciliation_results_2a' : 'reconciliation_results';
        let statusTable = is2a ? 'reconciliation_status_gst2a_vs_book' : 'reconciliation_status';
        
        if (run_type === 'GSTR2A_VS_GSTR2B') {
            statusTable = 'reconciliation_status_2a_vs_2b';
        }

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
            return errorResponse(res, `Invalid or missing recon_status.`, 400);
        }

        // 1. Fetch the reconciliation result to get invoice IDs and verify ownership
        const reconResult = await trx(resultsTable)
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

        const { purchase_invoice_id, gstr2b_invoice_id, gstr2a_invoice_id } = reconResult;
        const gstrId = is2a ? (gstr2a_invoice_id || reconResult.gstr2a_source_id) : gstr2b_invoice_id;

        // 3. Upsert logic for reconciliation_status
        let existing = null;
        if (run_type === 'GSTR2A_VS_GSTR2B') {
            if (gstr2a_invoice_id) {
                existing = await trx(statusTable)
                    .where({ workspace_id: workspaceId, gstr2a_invoice_id })
                    .first();
            }
            if (!existing && gstr2b_invoice_id) {
                existing = await trx(statusTable)
                    .where({ workspace_id: workspaceId, gstr2b_invoice_id })
                    .first();
            }
        } else {
            if (purchase_invoice_id) {
                existing = await trx(statusTable)
                    .where({ workspace_id: workspaceId, book_data_id: purchase_invoice_id })
                    .first();
            }
            if (!existing && gstrId) {
                existing = await trx(statusTable)
                    .where({ workspace_id: workspaceId, gstr_data_id: gstrId })
                    .first();
            }
        }

        let statusRecord;
        if (existing) {
            [statusRecord] = await trx(statusTable)
                .where({ id: existing.id })
                .update({
                    recon_status,
                    updated_date: knex.fn.now()
                })
                .returning('*');
        } else {
            const insertData = {
                workspace_id: workspaceId,
                tenant_id,
                recon_status,
                added_date: knex.fn.now(),
                updated_date: knex.fn.now()
            };

            if (run_type === 'GSTR2A_VS_GSTR2B') {
                insertData.gstr2a_invoice_id = gstr2a_invoice_id;
                insertData.gstr2b_invoice_id = gstr2b_invoice_id;
            } else {
                insertData.gstr_data_id = gstrId;
                insertData.book_data_id = purchase_invoice_id;
                insertData.updated_by = userId || null;
                insertData.extra_info = { recon_result_id: resultIdInt };
            }

            [statusRecord] = await trx(statusTable)
                .insert(insertData)
                .returning('*');
        }

        // 4. Update reconciliation_results table directly for fast filtering/UI
        await trx(resultsTable)
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

        cleanup();
        return successResponse(res, statusRecord, 'Reconciliation status updated successfully');
    } catch (error) {
        cleanup();
        if (trx) await trx.rollback();
        console.error('[updateReconStatus] Critical Error:', error);
        
        // Temporary file logging for debugging
        const logPath = path.join(__dirname, 'debug_error.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Error updating status for result ${req.params.result_id}: ${error.message}\n${error.stack}\n\n`);
        
        return errorResponse(res, error.message, 500);
    }
};

const notifySupplier = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        console.log(`[notifySupplier] Request received for workspace: ${workspaceId}`);
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const { to, subject, body, supplier_gstin } = req.body;
        console.log(`[notifySupplier] Payload: to=${to}, subject=${subject}, gstin=${supplier_gstin}`);
        if (!to || !subject || !body) {
            return errorResponse(res, 'to, subject, and body are required', 400);
        }

        // Publish event to NATS
        publishMessage('SUPPLIER_MAIL_REQUESTED', { to, subject, body });
        console.log(`[notifySupplier] NATS event SUPPLIER_MAIL_REQUESTED published`);

        // Async update supplier_master if GSTIN is provided
        if (supplier_gstin) {
            knex('supplier_master')
                .where({ workspace_id: workspaceId, gstin: supplier_gstin }) // Note: Column is 'gstin' not 'supplier_gstin'
                .update({ 
                    email: to, // Note: Column is 'email' not 'supplier_email'
                    updated_at: knex.fn.now() 
                })
                .then(count => {
                    if (count > 0) console.log(`[notifySupplier] Updated email for supplier ${supplier_gstin} in master table`);
                })
                .catch(err => console.error(`[notifySupplier] Error updating supplier master email:`, err));
        }

        return successResponse(res, null, 'Mail-send request successfully published', 200);
    } catch (error) {
        console.error('Error notifying supplier:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    takeAction,
    getPendingActions,
    updateReconStatus,
    notifySupplier
};
