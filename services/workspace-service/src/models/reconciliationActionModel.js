const knex = require('../../../shared/src/db/connection');

class ReconciliationActionModel {
    /**
     * Create a new action and update the result status
     */
    static async createAction(resultId, actionData, userId) {
        const trx = await knex.transaction();

        try {
            const { action_type, decision, decision_reason, notes, action_status, run_type = 'PURCHASE_2B' } = actionData;
            const is2a = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run_type);
            const resultsTable = is2a ? 'reconciliation_results_2a' : 'reconciliation_results';
            let statusTable = is2a ? 'reconciliation_status_gst2a_vs_book' : 'reconciliation_status';
            if (run_type === 'GSTR2A_VS_GSTR2B') statusTable = 'reconciliation_status_2a_vs_2b';

            // 1. Fetch the reconciliation result for context and IDs
            const reconResult = await trx(resultsTable)
                .leftJoin('purchase_vouchers', `${resultsTable}.purchase_invoice_id`, 'purchase_vouchers.id')
                .leftJoin('normalized_gstr2b_invoices', `${resultsTable}.gstr2b_invoice_id`, 'normalized_gstr2b_invoices.id')
                .leftJoin('normalized_gstr2a_invoices', `${resultsTable}.gstr2a_invoice_id`, 'normalized_gstr2a_invoices.id')
                .where({ [`${resultsTable}.id`]: resultId })
                .select(
                    `${resultsTable}.*`,
                    'purchase_vouchers.supplier_invoice_no as purchase_invoice_number',
                    'normalized_gstr2b_invoices.document_number_clean as gstr2b_invoice_number',
                    'normalized_gstr2a_invoices.document_number_clean as gstr2a_invoice_number'
                )
                .first();
            if (!reconResult) throw new Error('Reconciliation result not found');

            // 2. Log the action
            const [action] = await trx('reconciliation_actions')
                .insert({
                    reconciliation_result_id: resultId,
                    action_type,
                    decision,
                    decision_reason,
                    performed_by: userId,
                    notes
                })
                .returning('*');

            // 3. Update the reconciliation result
            const updateData = {
                updated_at: knex.fn.now()
            };

            if (action_status) updateData.action_status = action_status;
            if (decision) updateData.itc_decision = decision;
            if (decision_reason) updateData.decision_reason = decision_reason;
            if (userId) updateData.assigned_to = userId;

            // 4. Broadcast update: Sync action_status across ALL reconciliation results sharing these invoices
            const workspaceId = reconResult.workspace_id;
            const { purchase_invoice_id, gstr2b_invoice_id, gstr2a_invoice_id } = reconResult;

            if (action_status) {
                const broadcastUpdate = {
                    action_status,
                    updated_at: knex.fn.now()
                };

                // Update main reconciliation_results
                await trx('reconciliation_results')
                    .where(function () {
                        if (purchase_invoice_id) this.orWhere('purchase_invoice_id', purchase_invoice_id);
                        if (gstr2b_invoice_id) this.orWhere('gstr2b_invoice_id', gstr2b_invoice_id);
                        if (run_type === 'GSTR2A_VS_GSTR2B' && gstr2a_invoice_id) this.orWhere('gstr2b_invoice_id', gstr2a_invoice_id);
                    })
                    .andWhere('workspace_id', workspaceId)
                    .update(broadcastUpdate);

                // Update 2A reconciliation_results_2a
                await trx('reconciliation_results_2a')
                    .where(function () {
                        if (purchase_invoice_id) this.orWhere('purchase_invoice_id', purchase_invoice_id);
                        if (gstr2a_invoice_id) this.orWhere('gstr2a_invoice_id', gstr2a_invoice_id);
                        if (gstr2b_invoice_id) this.orWhere('gstr2a_invoice_id', gstr2b_invoice_id);
                    })
                    .andWhere('workspace_id', workspaceId)
                    .update(broadcastUpdate);
            } else {
                // If only updating other fields (decision, reason) without status change
                await trx(resultsTable)
                    .where({ id: resultId })
                    .update(updateData);
            }

            // 5. Sync with reconciliation_status table for global persistence
            if (action_status || decision) {
                const workspaceId = reconResult.workspace_id;
                const { purchase_invoice_id, gstr2b_invoice_id, gstr2a_invoice_id } = reconResult;
                const gstrId = is2a ? (gstr2a_invoice_id || reconResult.gstr2a_source_id) : gstr2b_invoice_id;

                let existingStatus = null;
                if (run_type === 'GSTR2A_VS_GSTR2B') {
                    if (gstr2a_invoice_id) existingStatus = await trx(statusTable).where({ workspace_id: workspaceId, gstr2a_invoice_id }).first();
                    if (!existingStatus && gstr2b_invoice_id) existingStatus = await trx(statusTable).where({ workspace_id: workspaceId, gstr2b_invoice_id }).first();
                } else {
                    if (purchase_invoice_id) existingStatus = await trx(statusTable).where({ workspace_id: workspaceId, book_data_id: purchase_invoice_id }).first();
                    if (!existingStatus && gstrId) existingStatus = await trx(statusTable).where({ workspace_id: workspaceId, gstr_data_id: gstrId }).first();
                }

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

                if (existingStatus) {
                    await trx(statusTable).where({ id: existingStatus.id }).update({
                        recon_status: action_status || existingStatus.recon_status,
                        extra_info: { ...(existingStatus.extra_info || {}), ...extraInfo },
                        updated_by: userId,
                        updated_date: knex.fn.now()
                    });
                } else {
                    const insertData = {
                        workspace_id: workspaceId,
                        tenant_id: reconResult.tenant_id || workspaceId,
                        recon_status: action_status || 'pending',
                        added_by: userId,
                        updated_by: userId,
                        extra_info: extraInfo
                    };
                    if (run_type === 'GSTR2A_VS_GSTR2B') {
                        insertData.gstr2a_invoice_id = gstr2a_invoice_id;
                        insertData.gstr2b_invoice_id = gstr2b_invoice_id;
                        insertData.gstr_type = 'gstr2a2b';
                    } else {
                        insertData.gstr_data_id = gstrId;
                        insertData.book_data_id = purchase_invoice_id;
                        insertData.gstr_type = is2a ? 'gstr2a' : 'gstr2b';
                        insertData.book_data_type = 'purchase_voucher';
                    }
                    await trx(statusTable).insert(insertData);
                }
            }

            await trx.commit();
            return action;
        } catch (error) {
            if (trx) await trx.rollback();
            throw error;
        }
    }

    /**
     * Get pending actions for a workspace
     */
    static async getPendingActions(workspaceId, filters = {}, pagination = {}) {
        const { priority, assigned_to } = filters;
        const { page = 1, page_size = 20 } = pagination;
        const offset = (page - 1) * page_size;

        const query = knex('reconciliation_results as rr')
            .join('reconciliation_runs as run', 'rr.recon_run_id', 'run.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .where('rr.workspace_id', workspaceId)
            .where('rr.action_status', 'PENDING')
            .whereNotNull('rr.action_required');

        if (priority) query.where('rr.action_priority', priority);
        if (assigned_to) query.where('rr.assigned_to', assigned_to);

        const results = await query.select(
            'rr.*',
            'run.period_id',
            'pi.supplier_invoice_no as purchase_invoice_number',
            'gi.document_number_clean as gstr2b_invoice_number'
        )
            .orderBy('rr.created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return results;
    }
}

module.exports = ReconciliationActionModel;
