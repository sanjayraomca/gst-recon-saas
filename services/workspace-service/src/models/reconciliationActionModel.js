const db = require('../../../shared/src/db/connection');

class ReconciliationActionModel {
    /**
     * Create a new action and update the result status
     */
    static async createAction(resultId, actionData, userId) {
        const trx = await db.transaction();

        try {
            const { action_type, decision, decision_reason, notes, action_status } = actionData;

            // 1. Log the action
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

            // 2. Update the reconciliation result
            const updateData = {
                updated_at: db.fn.now()
            };

            if (action_status) updateData.action_status = action_status;
            if (decision) updateData.itc_decision = decision;
            if (decision_reason) updateData.decision_reason = decision_reason;
            // If action is resolving the issue, we might change match_status or just action_status
            // For now, we trust the input to guide what fields to update.

            // Auto-assign validation
            if (userId) updateData.assigned_to = userId;

            await trx('reconciliation_results')
                .where({ id: resultId })
                .update(updateData);

            await trx.commit();
            return action;
        } catch (error) {
            await trx.rollback();
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

        const query = db('reconciliation_results as rr')
            .join('reconciliation_runs as run', 'rr.recon_run_id', 'run.id')
            .leftJoin('purchase_invoices as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .where('rr.workspace_id', workspaceId)
            .where('rr.action_status', 'PENDING')
            .whereNotNull('rr.action_required');

        if (priority) query.where('rr.action_priority', priority);
        if (assigned_to) query.where('rr.assigned_to', assigned_to);

        const results = await query.select(
            'rr.*',
            'run.period_id',
            'pi.invoice_number as purchase_invoice_number',
            'gi.invoice_number as gstr2b_invoice_number'
        )
            .orderBy('rr.created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return results;
    }
}

module.exports = ReconciliationActionModel;
