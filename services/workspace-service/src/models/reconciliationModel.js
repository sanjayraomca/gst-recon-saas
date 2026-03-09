const knex = require('../../../shared/src/db/connection');
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

            // If period (MMYYYY) provided, look up or create ID
            if (!taxPeriodId && period && period !== 'ALL') {
                taxPeriodId = await this.ensureTaxPeriodExists(period, trx);
            }

            if (!taxPeriodId && period !== 'ALL') {
                throw new Error('Either period_id or period (MMYYYY) or "ALL" is required');
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
        let trx;
        try {
            await progressEmitter.emitProgress(runId, 5, 'Starting reconciliation run...');

            trx = await knex.transaction();

            // Extract run_type from runData (fix for undefined variable bug)
            const run_type = runData.run_type || 'PURCHASE_2B';

            // Fetch the tax period details (month/year) so we can filter invoice dates
            let taxPeriod = null;
            if (taxPeriodId) {
                taxPeriod = await trx('tax_periods').where({ id: taxPeriodId }).first();
            }

            // 2. Fetch purchase vouchers for this workspace/period
            await progressEmitter.emitProgress(runId, 15, 'Fetching purchase invoices...');
            let purchaseQuery = trx('purchase_vouchers')
                .select('purchase_vouchers.*')
                .where({ 'purchase_vouchers.workspace_id': workspaceId });

            // Filter by invoice date if we have the period details
            if (taxPeriod) {
                purchaseQuery = purchaseQuery
                    .whereRaw('EXTRACT(MONTH FROM purchase_vouchers.supplier_invoice_date) = ?', [taxPeriod.month])
                    .whereRaw('EXTRACT(YEAR FROM purchase_vouchers.supplier_invoice_date) = ?', [taxPeriod.year]);
            }

            const purchaseInvoices = await purchaseQuery;

            // 3. Fetch GSTR (2A or 2B) invoices
            const is2a = run_type === 'PURCHASE_2A';
            const portalTypeLabel = is2a ? 'GSTR-2A' : 'GSTR-2B';
            const sourcePrefix = is2a ? 'gstr_2a_%' : 'gstr_2b_%';

            await progressEmitter.emitProgress(runId, 30, `Fetching ${portalTypeLabel} invoices...`);
            let gstrQuery = trx('normalized_gstr2b_invoices')
                .select('normalized_gstr2b_invoices.*')
                .where({ 'normalized_gstr2b_invoices.workspace_id': workspaceId })
                .where('normalized_gstr2b_invoices.source_table', 'like', sourcePrefix);

            // Filter by document date if we have the period details
            if (taxPeriod) {
                gstrQuery = gstrQuery
                    .whereRaw('EXTRACT(MONTH FROM normalized_gstr2b_invoices.document_date) = ?', [taxPeriod.month])
                    .whereRaw('EXTRACT(YEAR FROM normalized_gstr2b_invoices.document_date) = ?', [taxPeriod.year]);
            }

            const gstr2bInvoices = await gstrQuery;


            // 4. Perform matching
            await progressEmitter.emitProgress(runId, 45, 'Performing rule-based matching...');
            const matchResults = [];
            const matchedGstr2bIds = new Set();
            const unmatchedPurchases = [];
            let matchedCount = 0;
            let mismatchedCount = 0;
            let missingCount = 0;

            // Step 0: Filter out invoices without GSTIN for matching
            const validPurchaseInvoices = purchaseInvoices.filter(p => !!this.normalizeGstin(p.supplier_gstin));
            const validGstr2bInvoices = gstr2bInvoices.filter(g => !!this.normalizeGstin(g.supplier_gstin));

            // Helper to map Books categories to Portal categories
            const mapCategory = (booksType) => {
                const type = (booksType || 'PURCHASE').toUpperCase();
                if (type === 'CREDIT_NOTE') return 'CREDIT_NOTE';
                if (type === 'DEBIT_NOTE') return 'DEBIT_NOTE';
                return 'INVOICE'; // PURCHASE, EXPENSE -> INVOICE
            };

            for (const purchaseInv of validPurchaseInvoices) {
                const pNet = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                const pTaxable = isNaN(parseFloat(purchaseInv.taxable_total)) ? 0 : parseFloat(purchaseInv.taxable_total);
                const pTax = (parseFloat(purchaseInv.total_igst_amount) || 0) + 
                             (parseFloat(purchaseInv.total_cgst_amount) || 0) + 
                             (parseFloat(purchaseInv.total_sgst_amount) || 0) + 
                             (parseFloat(purchaseInv.total_cess_amount) || 0);
                
                const pDate = new Date(purchaseInv.supplier_invoice_date);
                const pNormalizedInv = this.normalizeInvoiceNumber(purchaseInv.supplier_invoice_no);
                const pCategory = mapCategory(purchaseInv.voucher_type);
                
                let matchType = null;
                const match = validGstr2bInvoices.find(gstr2bInv => {
                    if (matchedGstr2bIds.has(gstr2bInv.id)) return false;

                    // 1. GSTIN Match
                    const gstinMatch = this.normalizeGstin(purchaseInv.supplier_gstin) === this.normalizeGstin(gstr2bInv.supplier_gstin);
                    if (!gstinMatch) return false;
                    
                    // 2. Category Match (Invoice vs Note)
                    const gCategory = gstr2bInv.document_category || 'INVOICE';
                    if (pCategory !== gCategory) return false;

                    // 3. Invoice Number Match (Including Amendment check)
                    const gNormalizedInv = this.normalizeInvoiceNumber(gstr2bInv.document_number_clean);
                    const gOriginalInv = this.normalizeInvoiceNumber(gstr2bInv.original_invoice_number);
                    const invMatch = (pNormalizedInv === gNormalizedInv) || (gOriginalInv && pNormalizedInv === gOriginalInv);
                    
                    if (!invMatch) return false;
                    
                    const gNet = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    const gTaxable = isNaN(parseFloat(gstr2bInv.taxable_value)) ? 0 : parseFloat(gstr2bInv.taxable_value);
                    const gTax = isNaN(parseFloat(gstr2bInv.total_tax)) ? 0 : parseFloat(gstr2bInv.total_tax);
                    const gDate = new Date(gstr2bInv.document_date);
                    
                    const dateDiff = Math.abs((pDate - gDate) / (1000 * 60 * 60 * 24));
                    const exactDate = dateDiff === 0;
                    const exactTaxable = Math.abs(pTaxable - gTaxable) < 0.01;
                    const exactTax = Math.abs(pTax - gTax) < 0.01;

                    // Case 1: Exact Match
                    if (exactDate && exactTaxable && exactTax) {
                        matchType = 'MATCHED';
                        return true;
                    }

                    // Case 2: Partial Match / Mismatch
                    const dateNear = dateDiff <= 2;
                    const taxableNear = Math.abs(pTaxable - gTaxable) <= 1.01;
                    const taxNear = Math.abs(pTax - gTax) <= 1.01;

                    if (dateNear && exactTaxable && exactTax) { matchType = 'MISMATCH'; return true; }
                    if (exactDate && taxableNear && exactTax) { matchType = 'MISMATCH'; return true; }
                    if (exactDate && exactTaxable && taxNear) { matchType = 'MISMATCH'; return true; }
                    if (exactDate && taxNear && !exactTaxable) { matchType = 'MISMATCH'; return true; }

                    return false;
                });

                if (match) {
                    matchedGstr2bIds.add(match.id);
                    const isEligible = match.itc_available !== false && match.itc_eligibility !== 'No' && match.itc_eligibility !== 'N';
                    
                    let finalStatus = isEligible ? matchType.toLowerCase() : 'not_eligible';
                    if (finalStatus === 'matched') matchedCount++;
                    else if (finalStatus === 'mismatch') mismatchedCount++;

                    matchResults.push({
                        recon_run_id: runId,
                        workspace_id: workspaceId,
                        purchase_invoice_id: purchaseInv.id,
                        gstr2b_invoice_id: match.id,
                        match_status: finalStatus,
                        match_score: finalStatus === 'matched' ? 100.00 : (finalStatus === 'not_eligible' ? 0 : 70.00),
                        match_confidence: finalStatus === 'matched' ? 'HIGH' : 'MEDIUM',
                        books_value: pNet,
                        portal_value: match.document_value || 0,
                        variance_amount: pNet - (match.document_value || 0),
                        itc_decision: isEligible ? (matchType === 'MATCHED' ? 'ELIGIBLE' : 'PENDING') : 'INELIGIBLE',
                        decision_reason: !isEligible ? 'ITC Not Available in GSTR2B' : (matchType === 'MATCHED' ? 'Exact match found' : 'Partial match / variance detected'),
                        action_required: !isEligible ? 'REVIEW_ELIGIBILITY' : (matchType === 'MISMATCH' ? 'REVIEW_AMOUNT' : null),
                        action_status: 'PENDING',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });

                } else {
                    unmatchedPurchases.push(purchaseInv);
                }
            }

            // 4c. Process unmatched purchases
            for (const purchaseInv of unmatchedPurchases) {
                const pTotal = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                matchResults.push({
                    recon_run_id: runId,
                    workspace_id: workspaceId,
                    purchase_invoice_id: purchaseInv.id,
                    match_status: 'missing_in_2b',
                    match_score: 0.00,
                    match_confidence: 'HIGH',
                    matched_by: 'RULE',
                    books_value: pTotal,
                    variance_amount: pTotal,
                    itc_decision: 'INELIGIBLE',
                    decision_reason: 'Not found in GSTR2B',
                    action_required: 'FOLLOW_UP_SUPPLIER',
                    action_priority: 'HIGH',
                    action_status: 'PENDING',
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now()
                });
                missingCount++;
            }

            // 4d. Unmatched GSTR-2B invoices
            for (const gstr2bInv of validGstr2bInvoices) {
                if (!matchedGstr2bIds.has(gstr2bInv.id)) {
                    const gTotal = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    const isEligible = gstr2bInv.itc_available !== false && gstr2bInv.itc_eligibility !== 'No' && gstr2bInv.itc_eligibility !== 'N';
                    
                    matchResults.push({
                        recon_run_id: runId,
                        workspace_id: workspaceId,
                        gstr2b_invoice_id: gstr2bInv.id,
                        match_status: isEligible ? 'missing_in_books' : 'not_eligible',
                        match_score: 0.00,
                        match_confidence: 'HIGH',
                        matched_by: 'RULE',
                        portal_value: gTotal,
                        variance_amount: -gTotal,
                        itc_decision: isEligible ? 'PENDING' : 'INELIGIBLE',
                        decision_reason: isEligible ? 'Not found in records' : 'ITC Not Available in GSTR2B',
                        action_required: isEligible ? 'ADD_TO_BOOKS' : 'REVIEW_ELIGIBILITY',
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
            if (trx) await trx.rollback();
            console.error(`[Recon Task] Run ${runId} failed:`, error.message, error);
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
            date_from,
            date_to,
            place_of_supply,
            page = 1,
            page_size = 50,
            export_mode
        } = filters;

        // Verify run belongs to workspace
        const run = await this.getRunById(workspaceId, runId);
        if (!run) return null;

        let query = knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .where('rr.recon_run_id', runId);

        // Hide records where GSTIN is missing (as per user request "else hide the data")
        query.where(function () {
            this.whereNotNull('pi.supplier_gstin')
                .orWhereNotNull('gi.supplier_gstin');
        }).andWhere(function () {
            this.where('pi.supplier_gstin', '!=', '')
                .orWhere('gi.supplier_gstin', '!=', '');
        });

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

        if (date_from) {
            query.where(function () {
                this.where('pi.due_date', '>=', date_from)
                    .orWhere('gi.document_date', '>=', date_from);
            });
        }

        if (date_to) {
            query.where(function () {
                this.where('pi.due_date', '<=', date_to)
                    .orWhere('gi.document_date', '<=', date_to);
            });
        }

        if (place_of_supply) {
            const states = place_of_supply.split(',').map(s => s.trim());
            query.where(function () {
                this.whereIn('pi.place_of_supply', states)
                    .orWhereIn('gi.place_of_supply', states);
            });
        }

        // Robust numeric filter handling to prevent 500 errors with "undefined" strings
        const isValidNumeric = (val) => val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val)) && isFinite(val);

        if (isValidNumeric(min_amount)) {
            const min = parseFloat(min_amount);
            query.where(function () {
                this.where('pi.net_amount', '>=', min)
                    .orWhere('gi.document_value', '>=', min);
            });
        }

        if (isValidNumeric(max_amount)) {
            const max = parseFloat(max_amount);
            query.where(function () {
                this.where('pi.net_amount', '<=', max)
                    .orWhere('gi.document_value', '<=', max);
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

        // --- Prepare Main Query ---
        query.select(
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
            knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) as gstr2b_tax'),
            knex.raw('CASE WHEN gi.taxable_value > 0 THEN ROUND(((COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) / gi.taxable_value) * 100) ELSE 0 END as gstr2b_tax_rate')
        ).orderBy('rr.created_at', 'desc');

        // --- Apply Pagination/Export Mode ---
        let results;
        if (export_mode === 'true' || export_mode === true) {
            // No limit/offset for export mode
            results = await query;
        } else {
            const limit = parseInt(page_size) || 50;
            const offset = (parseInt(page) - 1) * limit;
            results = await query.limit(limit).offset(offset);
        }

        return {
            data: results,
            pagination: {
                total,
                page: parseInt(page),
                page_size: export_mode ? total : parseInt(page_size),
                total_pages: export_mode ? 1 : Math.ceil(total / parseInt(page_size))
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

    static calculateSimilarity(s1, s2) {
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1;
        
        const m = s1.length;
        const n = s2.length;
        const dp = Array.from(Array(m + 1), () => Array(n + 1).fill(0));
        
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1, // deletion
                        dp[i][j - 1] + 1, // insertion
                        dp[i - 1][j - 1] + 1 // substitution
                    );
                }
            }
        }
        
        const maxLen = Math.max(m, n);
        const distance = dp[m][n];
        return (maxLen - distance) / maxLen;
    }

    static normalizeGstin(gstin) {
        return (gstin || '').trim().toUpperCase();
    }

    /**
     * Helper: Calculate financial year from return period (MMYYYY)
     */
    static calculateFinancialYear(returnPeriod) {
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));

        if (month >= 4) {
            return `${year}-${(year + 1).toString().substring(2)}`;
        } else {
            return `${year - 1}-${year.toString().substring(2)}`;
        }
    }

    /**
     * Ensure tax period exists in the database, creating it if necessary.
     */
    static async ensureTaxPeriodExists(returnPeriod, trx) {
        const db = trx || knex;
        const taxPeriod = await db('tax_periods')
            .select('id')
            .where({ period_code: returnPeriod })
            .first();

        if (taxPeriod) {
            return taxPeriod.id;
        }

        console.log(`[ReconciliationModel] Creating missing tax period: ${returnPeriod}`);
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));
        const fyCode = this.calculateFinancialYear(returnPeriod);

        // 1. Get or Create Financial Year
        let fyId;
        const fy = await db('financial_years')
            .select('id')
            .where({ fy_code: fyCode })
            .first();

        if (fy) {
            fyId = fy.id;
        } else {
            const startYear = parseInt(fyCode.split('-')[0]);
            const startDate = `${startYear}-04-01`;
            const endDate = `${startYear + 1}-03-31`;
            const [newFy] = await db('financial_years')
                .insert({
                    fy_code: fyCode,
                    display_name: `FY ${fyCode}`,
                    start_date: startDate,
                    end_date: endDate
                })
                .returning('id');
            fyId = newFy.id;
        }

        // 2. Create Tax Period
        const startDateString = `${year}-${returnPeriod.substring(0, 2)}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDateString = `${year}-${returnPeriod.substring(0, 2)}-${lastDay}`;
        const quarter = Math.ceil(month / 3);
        const displayName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

        const [newPeriod] = await db('tax_periods')
            .insert({
                fy_id: fyId,
                month,
                year,
                period_code: returnPeriod,
                display_name: displayName,
                start_date: startDateString,
                end_date: endDateString,
                period_type: 'MONTHLY',
                quarter
            })
            .returning('id');

        return newPeriod.id;
    }
}

module.exports = ReconciliationModel;
