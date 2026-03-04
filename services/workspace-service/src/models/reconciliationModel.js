const knex = require('../../../shared/src/db/connection');
const { findAIMatches, AI_MATCHING_ENABLED } = require('../services/aiMatchingService');
const progressEmitter = require('../utils/progressEmitter');

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

            await trx.commit();

            const runId = reconRun.id;

            // Trigger the matching task in the background (no await)
            this.runMatchingTask(workspaceId, runId, taxPeriodId, runData).catch(err => {
                console.error(`[AI Matching Error] Background task failed for run ${runId}:`, err);
            });

            return runId;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }

    /**
     * Background task to perform the actual reconciliation matching
     */
    static async runMatchingTask(workspaceId, runId, taxPeriodId, runData) {
        try {
            await progressEmitter.emitProgress(runId, 5, 'Starting reconciliation run...');

            const trx = await knex.transaction();
            // ... rest of the logic ...

            // 2. Fetch purchase vouchers
            await progressEmitter.emitProgress(runId, 15, 'Fetching purchase invoices...');
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
            await progressEmitter.emitProgress(runId, 30, 'Fetching GSTR-2B invoices...');
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
            await progressEmitter.emitProgress(runId, 45, 'Performing rule-based matching...');
            const matchResults = [];
            const matchedGstr2bIds = new Set();
            const unmatchedPurchases = []; // Collected for AI matching
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
                        recon_run_id: runId,
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
                    // Collect for AI matching instead of immediately marking as MISSING
                    unmatchedPurchases.push(purchaseInv);
                }
            }

            // 4b. AI Fuzzy Matching — run on unmatched purchase invoices
            let aiMatchMap = new Map();
            if (AI_MATCHING_ENABLED && unmatchedPurchases.length > 0) {
                await progressEmitter.emitProgress(runId, 70, `Running AI matching for ${unmatchedPurchases.length} invoices...`);
                const unmatchedGstr2b = gstr2bInvoices.filter(g => !matchedGstr2bIds.has(g.id));
                aiMatchMap = await findAIMatches(unmatchedPurchases, unmatchedGstr2b);
            }

            // 4c. Process unmatched purchases (with AI results if available)
            for (const purchaseInv of unmatchedPurchases) {
                const pTotal = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                const aiResult = aiMatchMap.get(purchaseInv.id);

                if (aiResult && aiResult.matched && aiResult.gstr2b_id) {
                    // AI found a match — look up the GSTR2B invoice
                    const aiGstr2bInv = gstr2bInvoices.find(g => g.id === aiResult.gstr2b_id);
                    if (aiGstr2bInv && !matchedGstr2bIds.has(aiGstr2bInv.id)) {
                        matchedGstr2bIds.add(aiGstr2bInv.id);
                        const gTotal = isNaN(parseFloat(aiGstr2bInv.document_value)) ? 0 : parseFloat(aiGstr2bInv.document_value);
                        const amountDiff = Math.abs(pTotal - gTotal);
                        const isExactAmount = amountDiff <= 1.00;

                        matchResults.push({
                            recon_run_id: runId,
                            workspace_id: workspaceId,
                            purchase_invoice_id: purchaseInv.id,
                            gstr2b_invoice_id: aiGstr2bInv.id,
                            match_status: isExactAmount ? 'AI_MATCHED' : 'AI_PARTIAL',
                            match_score: aiResult.confidence_score,
                            match_confidence: aiResult.confidence_score >= 90 ? 'HIGH' : 'MEDIUM',
                            matched_by: 'AI',
                            ai_confidence_score: aiResult.confidence_score,
                            ai_match_reason: aiResult.reason,
                            books_value: pTotal,
                            portal_value: gTotal,
                            variance_amount: pTotal - gTotal,
                            itc_decision: isExactAmount ? 'ELIGIBLE' : 'PENDING',
                            decision_reason: `AI Match: ${aiResult.reason}`,
                            action_required: isExactAmount ? null : 'REVIEW_AMOUNT',
                            action_status: 'PENDING',
                            created_at: knex.fn.now(),
                            updated_at: knex.fn.now()
                        });

                        if (isExactAmount) matchedCount++;
                        else mismatchedCount++;
                        continue;
                    }
                }

                // No AI match — mark as MISSING
                matchResults.push({
                    recon_run_id: runId,
                    workspace_id: workspaceId,
                    purchase_invoice_id: purchaseInv.id,
                    match_status: 'MISSING',
                    match_score: 0.00,
                    match_confidence: 'HIGH',
                    matched_by: 'RULE',
                    books_value: pTotal,
                    variance_amount: pTotal,
                    itc_decision: 'INELIGIBLE',
                    decision_reason: 'Not found in GSTR2B',
                    action_required: 'VERIFY_SUPPLIER',
                    action_priority: 'HIGH',
                    action_status: 'PENDING',
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now()
                });
                missingCount++;
            }

            // 4d. Unmatched GSTR-2B invoices (in portal but not in books)
            for (const gstr2bInv of gstr2bInvoices) {
                if (!matchedGstr2bIds.has(gstr2bInv.id)) {
                    const gTotal = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    matchResults.push({
                        recon_run_id: runId,
                        workspace_id: workspaceId,
                        gstr2b_invoice_id: gstr2bInv.id,
                        match_status: 'MISSING',
                        match_score: 0.00,
                        match_confidence: 'HIGH',
                        matched_by: 'RULE',
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
                await progressEmitter.emitProgress(runId, 85, 'Saving reconciliation results...');
                await trx('reconciliation_results').insert(matchResults);
            }

            await trx('reconciliation_runs')
                .where({ id: runId })
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
            await progressEmitter.emitProgress(runId, 100, 'Reconciliation completed successfully');
        } catch (error) {
            await trx.rollback();
            console.error(`[Recon Task] Run ${runId} failed:`, error.message);
            await progressEmitter.emitProgress(runId, 0, `Failed: ${error.message}`, true);
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
     * Get run results with pagination and advanced filtering
     */
    static async getRunResults(workspaceId, runId, filters = {}) {
        const {
            match_status,
            action_required,
            search,
            min_amount,
            max_amount,
            has_variance,
            supplier_gstin,
            page = 1,
            page_size = 50
        } = filters;

        const limit = parseInt(page_size);
        const offset = (parseInt(page) - 1) * limit;

        // Verify run belongs to workspace
        const run = await this.getRunById(workspaceId, runId);
        if (!run) return null;

        let query = knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .where('rr.recon_run_id', runId);

        // --- Apply Filters ---
        if (match_status && match_status !== 'all') {
            query.where('rr.match_status', match_status);
        }

        if (action_required && action_required !== 'false') {
            query.whereNotNull('rr.action_required');
        }

        if (supplier_gstin) {
            query.where(function () {
                this.where('pi.supplier_gstin', supplier_gstin)
                    .orWhere('gi.supplier_gstin', supplier_gstin);
            });
        }

        if (min_amount) {
            query.where(function () {
                this.where('pi.net_amount', '>=', min_amount)
                    .orWhere('gi.document_value', '>=', min_amount);
            });
        }

        if (max_amount) {
            query.where(function () {
                this.where('pi.net_amount', '<=', max_amount)
                    .orWhere('gi.document_value', '<=', max_amount);
            });
        }

        if (has_variance === 'true') {
            query.where('rr.variance_amount', '!=', 0);
        }

        if (search) {
            query.where(function () {
                this.where('pi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('gi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_invoice_no', 'ilike', `%${search}%`)
                    .orWhere('gi.document_number_clean', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_gstin', 'ilike', `%${search}%`)
                    .orWhere('gi.supplier_gstin', 'ilike', `%${search}%`);
            });
        }

        // --- Calculate Totals before limit/offset ---
        const countQuery = query.clone().clearSelect().count('* as total');
        const countResult = await countQuery.first();
        const total = parseInt(countResult.total);

        // --- Execute Paged Query ---
        const results = await query.select(
            'rr.*',
            // Supplier mapping
            knex.raw('COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name'),
            knex.raw('COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin'),

            // Purchase/Books mapping
            'pi.supplier_invoice_no as purchase_invoice_number',
            'pi.due_date as purchase_invoice_date',
            'pi.net_amount as purchase_invoice_total',
            'pi.taxable_total as purchase_taxable',
            knex.raw('COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0) as purchase_tax'),
            knex.raw('CASE WHEN pi.taxable_total > 0 THEN ROUND(((COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0)) / pi.taxable_total) * 100) ELSE 0 END as purchase_tax_rate'),

            // GSTR-2B mapping
            'gi.document_number_clean as gstr2b_invoice_number',
            'gi.document_date as gstr2b_invoice_date',
            'gi.document_value as gstr2b_invoice_total',
            'gi.taxable_value as gstr2b_taxable',
            'gi.total_tax as gstr2b_tax',
            'gi.applicable_tax_rate_percent as gstr2b_tax_rate'
        )
            .orderBy('rr.created_at', 'desc')
            .limit(limit)
            .offset(offset);

        return {
            data: results,
            pagination: {
                total,
                page: parseInt(page),
                page_size: limit,
                total_pages: Math.ceil(total / limit)
            }
        };
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
