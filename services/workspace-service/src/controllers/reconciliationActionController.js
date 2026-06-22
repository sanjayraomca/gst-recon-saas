const ReconciliationActionModel = require('../models/reconciliationActionModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { logAudit } = require('../../../shared/src/utils/auditLogger');
const knex = require('../../../shared/src/db/connection');
const { attachSqlFileLogger } = require('../utils/sqlFileLogger');
const { publishMessage } = require('../../../shared/src/nats/client');
const fs = require('fs');
const path = require('path');

const takeAction = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        // userId should be the internal UUID (db_id) resolved by authMiddleware
        const userId = req.user.db_id || req.user.sub || req.user.id;
        const actionData = req.body;

        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

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
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

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
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        const resultId = req.params.result_id;
        const userId = req.user.db_id || req.user.sub || req.user.id;
        const { recon_status, run_type = 'PURCHASE_2B', decision_reason, notes } = req.body;
        const is2a = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run_type);

        // Drop legacy check constraints that limit status values to a fixed list
        try {
            await trx.raw(`ALTER TABLE reconciliation_status DROP CONSTRAINT IF EXISTS chk_recon_status`);
            await trx.raw(`ALTER TABLE reconciliation_status_gst2a_vs_book DROP CONSTRAINT IF EXISTS chk_recon_status_2a`);
            await trx.raw(`ALTER TABLE reconciliation_status_2a_vs_2b DROP CONSTRAINT IF EXISTS chk_recon_status_2a_vs_2b`);
        } catch (e) {
            // Ignore if fails (e.g. permission issues or already dropped)
            console.log('[updateReconStatus] Note: Could not drop status constraints, continuing...');
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
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
        }

        // No parseInt needed for UUIDs


        if (!recon_status || !VALID_STATUSES.includes(recon_status)) {
            await trx.rollback();
            return errorResponse(res, `Invalid or missing recon_status.`, 400);
        }

        // 1. Fetch the reconciliation result with invoice details for auditing
        const reconResult = await trx(resultsTable)
            .leftJoin('purchase_vouchers', `${resultsTable}.purchase_invoice_id`, 'purchase_vouchers.id')
            .leftJoin('normalized_gstr2b_invoices', `${resultsTable}.gstr2b_invoice_id`, 'normalized_gstr2b_invoices.id')
            .leftJoin('normalized_gstr2a_invoices', `${resultsTable}.gstr2a_invoice_id`, 'normalized_gstr2a_invoices.id')
            .where({ [`${resultsTable}.id`]: resultId, [`${resultsTable}.workspace_id`]: workspaceId })
            .select(
                `${resultsTable}.*`,
                'purchase_vouchers.supplier_invoice_no as purchase_invoice_number',
                'purchase_vouchers.supplier_invoice_date as purchase_invoice_date',
                'purchase_vouchers.supplier_gstin as purchase_supplier_gstin',
                'normalized_gstr2b_invoices.document_number_clean as gstr2b_invoice_number',
                'normalized_gstr2b_invoices.document_date as gstr2b_invoice_date',
                'normalized_gstr2b_invoices.supplier_gstin as gstr2b_supplier_gstin',
                'normalized_gstr2a_invoices.document_number_clean as gstr2a_invoice_number',
                'normalized_gstr2a_invoices.document_date as gstr2a_invoice_date',
                'normalized_gstr2a_invoices.supplier_gstin as gstr2a_supplier_gstin'
            )
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
        const extraInfo = {
            recon_result_id: resultId,
            match_score: reconResult.match_score,
            match_status: reconResult.match_status,
            recon_run_id: reconResult.recon_run_id,
            decision_reason: decision_reason || reconResult.decision_reason,
            notes: notes || reconResult.notes,
            // Include invoice identifiers to make audit logs searchable by invoice number
            purchase_invoice_number: reconResult.purchase_invoice_number,
            gstr2b_invoice_number: reconResult.gstr2b_invoice_number,
            gstr2a_invoice_number: reconResult.gstr2a_invoice_number
        };

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
                    extra_info: { ...(existing.extra_info || {}), ...extraInfo },
                    updated_by: userId,
                    updated_date: knex.fn.now()
                })
                .returning('*');
        } else {
            const insertData = {
                workspace_id: workspaceId,
                tenant_id,
                recon_status,
                gstr_type: is2a ? (run_type === 'GSTR2A_VS_GSTR2B' ? 'gstr2a2b' : 'gstr2a') : 'gstr2b',
                added_by: userId,
                updated_by: userId,
                added_date: knex.fn.now(),
                updated_date: knex.fn.now(),
                extra_info: extraInfo
            };

            if (run_type === 'GSTR2A_VS_GSTR2B') {
                insertData.gstr2a_invoice_id = gstr2a_invoice_id;
                insertData.gstr2b_invoice_id = gstr2b_invoice_id;
            } else {
                insertData.gstr_data_id = gstrId;
                insertData.book_data_id = purchase_invoice_id;
                insertData.book_data_type = 'purchase_voucher';
            }

            [statusRecord] = await trx(statusTable)
                .insert(insertData)
                .returning('*');
        }

        // 4. Broadcast update: Sync action_status across ALL reconciliation results sharing these invoices
        // This ensures consistency across different runs and reconciliation types (2B vs 2A vs 2A2B)
        const broadcastUpdate = {
            action_status: recon_status,
            updated_at: trx.fn.now()
        };

        // Update main reconciliation_results (2B vs Books)
        await trx('reconciliation_results')
            .where(function () {
                if (purchase_invoice_id) this.orWhere('purchase_invoice_id', purchase_invoice_id);
                if (gstr2b_invoice_id) this.orWhere('gstr2b_invoice_id', gstr2b_invoice_id);
                if (run_type === 'GSTR2A_VS_GSTR2B' && gstr2a_invoice_id) {
                    this.orWhere('gstr2b_invoice_id', gstr2a_invoice_id);
                }
            })
            .andWhere('workspace_id', workspaceId)
            .update(broadcastUpdate);

        // Update 2A reconciliation_results_2a (2A vs Books / 2A vs 2B)
        await trx('reconciliation_results_2a')
            .where(function () {
                if (purchase_invoice_id) this.orWhere('purchase_invoice_id', purchase_invoice_id);
                if (gstr2a_invoice_id) this.orWhere('gstr2a_invoice_id', gstr2a_invoice_id);
                if (gstr2b_invoice_id) this.orWhere('gstr2a_invoice_id', gstr2b_invoice_id); 
            })
            .andWhere('workspace_id', workspaceId)
            .update(broadcastUpdate);

        // 4.1 Update Source Tables for direct visibility in listings
        if (gstr2b_invoice_id) {
            await trx('normalized_gstr2b_invoices')
                .where({ id: gstr2b_invoice_id })
                .update({ reconciliation_status: recon_status, updated_at: trx.fn.now() });
        }
        if (gstr2a_invoice_id) {
            await trx('normalized_gstr2a_invoices')
                .where({ id: gstr2a_invoice_id })
                .update({ reconciliation_status: recon_status, updated_at: trx.fn.now() });
        }
        if (purchase_invoice_id) {
            await trx('purchase_vouchers')
                .where({ id: purchase_invoice_id })
                .update({ 
                    itc_claimed: ['claimed', 'claim'].includes(recon_status),
                    updated_at: trx.fn.now() 
                });
        }

        // 4.5. Log to data-level audit_log table
        await logAudit({
            tableName: statusTable,
            recordId: statusRecord.id,
            action: existing ? 'UPDATE' : 'INSERT',
            oldValue: existing || { initial_status: 'none' },
            newValue: statusRecord,
            modifiedBy: userId,
            trx
        });

        await trx.commit();

        // 5. Async Log Activity (outside transaction)
        const previousStatus = existing?.recon_status || 'initial';
        const invoiceDetails = {
            invoice_number: reconResult.purchase_invoice_number || reconResult.gstr2b_invoice_number || reconResult.gstr2a_invoice_number,
            invoice_date: reconResult.purchase_invoice_date || reconResult.gstr2b_invoice_date || reconResult.gstr2a_invoice_date,
            supplier_gstin: reconResult.purchase_supplier_gstin || reconResult.gstr2b_supplier_gstin || reconResult.gstr2a_supplier_gstin
        };

        logActivity({
            userId,
            tenantId,
            workspaceId,
            actionType: 'RECON_STATUS_UPDATE',
            entityType: 'ReconciliationStatus',
            entityId: statusRecord.id,
            details: { 
                resultId, 
                new_status: recon_status, 
                old_status: previousStatus,
                invoice: invoiceDetails,
                run_type,
                description: `Status changed from ${previousStatus} to ${recon_status} for ${invoiceDetails.invoice_number ? 'Invoice ' + invoiceDetails.invoice_number : 'this record'}.`
            },
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
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        console.log(`[notifySupplier] Request received for workspace: ${workspaceId}`);
        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

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
