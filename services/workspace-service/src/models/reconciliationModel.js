const knex = require('../../../shared/src/db/connection');

/**
 * Reconciliation Model
 * Handles invoice matching between purchase invoices and GSTR2B invoices
 */
class ReconciliationModel {
    /**
     * Trigger reconciliation for a specific GSTIN and period
     */
    /**
     * Create a reconciliation run
     */
    static async createRun(workspaceId, runData) {
        const trx = await knex.transaction();

        try {
            const { gstin_id, period, period_id, run_type = 'PURCHASE_2B', run_mode = 'MANUAL' } = runData;

            let taxPeriodId = period_id;

            // If period (MMYYYY) provided, look up ID
            if (!taxPeriodId && period) {
                const month = parseInt(period.substring(0, 2));
                const year = parseInt(period.substring(2, 6));

                const taxPeriod = await trx('tax_periods')
                    .select('id')
                    .where({ month, year })
                    .first();

                if (!taxPeriod) {
                    throw new Error(`Tax period ${period} not found`);
                }
                taxPeriodId = taxPeriod.id;
            }

            if (!taxPeriodId) {
                throw new Error('Either period_id or period (MMYYYY) is required');
            }

            // 1. Create reconciliation run record
            const [reconRun] = await trx('reconciliation_runs')
                .insert({
                    id: knex.raw('uuid_generate_v4()'),
                    workspace_id: workspaceId,
                    gstin_id: gstin_id,
                    period_id: taxPeriodId,
                    run_type: run_type,
                    run_mode: run_mode,
                    rule_set_version: '1.0.0',
                    rule_set_hash: 'basic_matching_v1',
                    status: 'RUNNING',
                    started_at: knex.fn.now(),
                    created_at: knex.fn.now()
                })
                .returning('*');

            // 2. Fetch purchase vouchers
            const purchaseInvoices = await trx('purchase_vouchers')
                .select('purchase_vouchers.*')
                .join('tax_periods', function () {
                    this.on('tax_periods.id', '=', knex.raw('?', [taxPeriodId]))
                })
                .where({
                    'purchase_vouchers.workspace_id': workspaceId,
                    'purchase_vouchers.tenant_id': runData.tenant_id || knex.raw('purchase_vouchers.tenant_id') // Avoid undefined error if not passed
                })
                .whereRaw('EXTRACT(MONTH FROM purchase_vouchers.supplier_invoice_date) = tax_periods.month')
                .whereRaw('EXTRACT(YEAR FROM purchase_vouchers.supplier_invoice_date) = tax_periods.year');

            // Handle optional gstin filter for purchase_vouchers if the schema has it. 
            // the schema has supplier_gstin, not gstin_id. Let's just pull all for the workspace/period 
            // or filter by supplier_gstin if runData.gstin is passed.
            // Since we don't have gstin_id on purchase_vouchers, we will filter in memory if needed.

            // 3. Fetch GSTR2B invoices
            const gstr2bInvoices = await trx('normalized_gstr2b_invoices')
                .select('normalized_gstr2b_invoices.*')
                .join('tax_periods', function () {
                    this.on('tax_periods.id', '=', knex.raw('?', [taxPeriodId]))
                })
                .where({
                    'normalized_gstr2b_invoices.workspace_id': workspaceId
                })
                .whereRaw('EXTRACT(MONTH FROM normalized_gstr2b_invoices.document_date) = tax_periods.month')
                .whereRaw('EXTRACT(YEAR FROM normalized_gstr2b_invoices.document_date) = tax_periods.year');

            // 4. Perform matching
            const matchResults = [];
            const matchedGstr2bIds = new Set();
            let matchedCount = 0;
            let mismatchedCount = 0;
            let missingCount = 0;

            for (const purchaseInv of purchaseInvoices) {
                const match = gstr2bInvoices.find(gstr2bInv =>
                    this.normalizeInvoiceNumber(purchaseInv.supplier_invoice_no) === this.normalizeInvoiceNumber(gstr2bInv.document_number_clean) &&
                    this.normalizeGstin(purchaseInv.supplier_gstin) === this.normalizeGstin(gstr2bInv.supplier_gstin)
                );

                if (match) {
                    matchedGstr2bIds.add(match.id);

                    const pTotal = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                    const gTotal = isNaN(parseFloat(match.document_value)) ? 0 : parseFloat(match.document_value);
                    const amountDiff = Math.abs(pTotal - gTotal);
                    const isExactMatch = amountDiff <= 1.00;

                    matchResults.push({
                        recon_run_id: reconRun.id,
                        workspace_id: workspaceId,
                        purchase_invoice_id: purchaseInv.id,
                        gstr2b_invoice_id: match.id,
                        match_status: isExactMatch ? 'EXACT' : 'PARTIAL',
                        match_score: isExactMatch ? 100.00 : 75.00,
                        match_confidence: isExactMatch ? 'HIGH' : 'MEDIUM',
                        books_value: pTotal,
                        portal_value: gTotal,
                        variance_amount: pTotal - gTotal,
                        itc_decision: isExactMatch ? 'ELIGIBLE' : 'PENDING',
                        decision_reason: isExactMatch ? 'Exact match found' : 'Amount mismatch',
                        action_required: isExactMatch ? null : 'REVIEW_AMOUNT',
                        action_status: 'PENDING',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });

                    if (isExactMatch) matchedCount++;
                    else mismatchedCount++;
                } else {
                    const pTotal = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                    matchResults.push({
                        recon_run_id: reconRun.id,
                        workspace_id: workspaceId,
                        purchase_invoice_id: purchaseInv.id,
                        match_status: 'MISSING', // Purchase present, GSTR2B missing
                        match_score: 0.00,
                        match_confidence: 'HIGH',
                        books_value: pTotal,
                        variance_amount: pTotal,
                        itc_decision: 'INELIGIBLE', // Can't claim if not in 2B
                        decision_reason: 'Not found in GSTR2B',
                        action_required: 'VERIFY_SUPPLIER',
                        action_priority: 'HIGH',
                        action_status: 'PENDING',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });
                    missingCount++;
                }
            }

            for (const gstr2bInv of gstr2bInvoices) {
                if (!matchedGstr2bIds.has(gstr2bInv.id)) {
                    const gTotal = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    matchResults.push({
                        recon_run_id: reconRun.id,
                        workspace_id: workspaceId,
                        gstr2b_invoice_id: gstr2bInv.id,
                        match_status: 'MISSING', // GSTR2B present, Purchase missing
                        match_score: 0.00,
                        match_confidence: 'HIGH',
                        portal_value: gTotal,
                        variance_amount: -gTotal,
                        itc_decision: 'PENDING',
                        decision_reason: 'Not found in purchase register',
                        action_required: 'ADD_TO_BOOKS',
                        action_priority: 'MEDIUM',
                        action_status: 'PENDING',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });
                    missingCount++;
                }
            }

            if (matchResults.length > 0) {
                await trx('reconciliation_results').insert(matchResults);
            }

            await trx('reconciliation_runs')
                .where({ id: reconRun.id })
                .update({
                    status: 'COMPLETED',
                    total_invoices: purchaseInvoices.length + gstr2bInvoices.length,
                    matched_count: matchedCount,
                    mismatched_count: mismatchedCount,
                    missing_count: missingCount,
                    completed_at: knex.fn.now(),
                    result_summary: JSON.stringify({
                        purchase_invoices: purchaseInvoices.length,
                        gstr2b_invoices: gstr2bInvoices.length,
                        matched: matchedCount,
                        mismatched: mismatchedCount,
                        missing: missingCount
                    })
                });

            await trx.commit();
            return reconRun.id;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }

    /**
     * Get list of reconciliation runs
     */
    static async getRuns(workspaceId, filters = {}, pagination = {}) {
        const { gstin_id, period_id, status } = filters;
        const { page = 1, page_size = 20 } = pagination;
        const offset = (page - 1) * page_size;

        const query = knex('reconciliation_runs')
            .where({ workspace_id: workspaceId });

        if (gstin_id) query.where({ gstin_id });
        if (period_id) query.where({ period_id });
        if (status) query.where({ status });

        const runs = await query.clone()
            .orderBy('created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return runs;
    }

    /**
     * Get run details
     */
    static async getRunById(workspaceId, runId) {
        return knex('reconciliation_runs')
            .where({ workspace_id: workspaceId, id: runId })
            .first();
    }

    /**
     * Get run results
     */
    static async getRunResults(workspaceId, runId, filters = {}, pagination = {}) {
        const { match_status, action_required } = filters;
        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        // Verify run belongs to workspace
        const run = await this.getRunById(workspaceId, runId);
        if (!run) return null;

        let query = knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .where('rr.recon_run_id', runId);

        if (match_status) query.where('rr.match_status', match_status);
        if (action_required) query.whereNotNull('rr.action_required');

        const results = await query.select(
            'rr.*',
            'pi.supplier_invoice_no as purchase_invoice_number',
            'pi.net_amount as purchase_invoice_total',
            'gi.document_number_clean as gstr2b_invoice_number',
            'gi.document_value as gstr2b_invoice_total'
        )
            .limit(page_size)
            .offset(offset);

        return results;
    }

    static normalizeInvoiceNumber(num) {
        if (!num) return '';
        // 1. Convert to uppercase
        // 2. Remove all non-alphanumeric characters (including spaces, hyphens, slashes)
        // 3. Remove leading zeros
        return num.toString().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
    }

    static normalizeGstin(gstin) {
        return (gstin || '').trim().toUpperCase();
    }
}

module.exports = ReconciliationModel;
