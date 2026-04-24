const knex = require('../../../shared/src/db/connection');
const progressEmitter = require('../utils/progressEmitter');
const Reconciliation2AModel = require('./reconciliation2AModel');

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
            const is2a = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run_type);

            // Trigger the matching task in the background (no await)
            if (is2a) {
                Reconciliation2AModel.runMatchingTask(workspaceId, runId, taxPeriodId, runData).catch(e => console.error('2A Match Task Error:', e));
            } else {
                this.runMatchingTask(workspaceId, runId, taxPeriodId, runData).catch(err => {
                    console.error(`[AI Matching Error] Background task failed for run ${runId}:`, err);
                });
            }

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

            // Extract run_type and determine if it is a 2A or 2A_VS_2B run
            const run_type = runData?.run_type || 'PURCHASE_2B';
            const is2a = run_type === 'PURCHASE_2A';
            const is2aVs2b = run_type === 'GSTR2A_VS_GSTR2B';

            // Fetch the tax period details (month/year) so we can filter invoice dates
            let taxPeriod = null;
            if (taxPeriodId) {
                taxPeriod = await trx('tax_periods').where({ id: taxPeriodId }).first();
            }

            // Fetch workspace settings for dynamic variances
            const workspace = await trx('workspaces').where({ id: workspaceId }).first();
            const wsSettings = typeof workspace?.settings === 'string'
                ? JSON.parse(workspace.settings)
                : (workspace?.settings || {});

            const VAR_DAYS_MIN = parseFloat(wsSettings.variance_days_min) || 2;
            const VAR_DAYS_MAX = parseFloat(wsSettings.variance_days_max) || 2;
            const VAR_TAXABLE_MIN = parseFloat(wsSettings.variance_taxable_min) || 1;
            const VAR_TAXABLE_MAX = parseFloat(wsSettings.variance_taxable_max) || 1;
            const VAR_TAX_MIN = parseFloat(wsSettings.variance_tax_min) || 1;
            const VAR_TAX_MAX = parseFloat(wsSettings.variance_tax_max) || 1;

            // 2. Fetch "Source A" invoices (Purchase or GSTR-2A)
            await progressEmitter.emitProgress(runId, 15, is2aVs2b ? 'Fetching GSTR-2A invoices...' : 'Fetching purchase invoices...');
            let purchaseInvoices = [];

            if (is2aVs2b) {
                // For 2A vs 2B, Source A is 2A invoices from portal
                let sourceAQuery = trx('normalized_gstr2a_invoices')
                    .where({ workspace_id: workspaceId })
                    .where('source_table', 'like', 'gstr_2a%');

                if (taxPeriod) {
                    const isQuarterly = workspace?.filing_type === 'q';
                    if (isQuarterly && taxPeriod.quarter) {
                        let quarterMonths = [];
                        if (taxPeriod.quarter === 1) quarterMonths = [4, 5, 6];
                        else if (taxPeriod.quarter === 2) quarterMonths = [7, 8, 9];
                        else if (taxPeriod.quarter === 3) quarterMonths = [10, 11, 12];
                        else if (taxPeriod.quarter === 4) quarterMonths = [1, 2, 3];

                        sourceAQuery = sourceAQuery
                            .whereIn(trx.raw(`EXTRACT(MONTH FROM document_date)`), quarterMonths)
                            .whereRaw(`EXTRACT(YEAR FROM document_date) = ?`, [taxPeriod.year]);
                    } else {
                        sourceAQuery = sourceAQuery
                            .whereRaw(`EXTRACT(MONTH FROM document_date) = ?`, [taxPeriod.month])
                            .whereRaw(`EXTRACT(YEAR FROM document_date) = ?`, [taxPeriod.year]);
                    }
                }
                purchaseInvoices = await sourceAQuery;
            } else {
                let purchaseQuery;
                if (is2a) {
                    // For GSTR-2A vs Books, we aggregate from purchase_items
                    purchaseQuery = trx('purchase_items')
                        .join('purchase_vouchers', 'purchase_items.purchase_id', 'purchase_vouchers.id')
                        .select(
                            'purchase_vouchers.id',
                            'purchase_vouchers.supplier_invoice_no',
                            'purchase_vouchers.supplier_invoice_date',
                            'purchase_vouchers.supplier_gstin',
                            'purchase_vouchers.voucher_type',
                            'purchase_vouchers.place_of_supply'
                        )
                        .sum('purchase_items.taxable_amount as taxable_total')
                        .sum('purchase_items.igst_amount as total_igst_amount')
                        .sum('purchase_items.cgst_amount as total_cgst_amount')
                        .sum('purchase_items.sgst_amount as total_sgst_amount')
                        .sum('purchase_items.cess_amount as total_cess_amount')
                        .sum('purchase_items.total_amount_with_tax as net_amount')
                        .where({ 'purchase_vouchers.workspace_id': workspaceId })
                        .groupBy(
                            'purchase_vouchers.id',
                            'purchase_vouchers.supplier_invoice_no',
                            'purchase_vouchers.supplier_invoice_date',
                            'purchase_vouchers.supplier_gstin',
                            'purchase_vouchers.voucher_type',
                            'purchase_vouchers.place_of_supply'
                        );
                } else {
                    purchaseQuery = trx('purchase_vouchers')
                        .select('purchase_vouchers.*')
                        .where({ 'purchase_vouchers.workspace_id': workspaceId });
                }

                // Filter by invoice date if we have the period details
                if (taxPeriod) {
                    const isQuarterly = workspace?.filing_type === 'q';
                    const dateCol = 'purchase_vouchers.supplier_invoice_date';
                    if (isQuarterly && taxPeriod.quarter) {
                        let quarterMonths = [];
                        if (taxPeriod.quarter === 1) quarterMonths = [4, 5, 6];
                        else if (taxPeriod.quarter === 2) quarterMonths = [7, 8, 9];
                        else if (taxPeriod.quarter === 3) quarterMonths = [10, 11, 12];
                        else if (taxPeriod.quarter === 4) quarterMonths = [1, 2, 3];

                        purchaseQuery = purchaseQuery
                            .whereIn(trx.raw(`EXTRACT(MONTH FROM ${dateCol})`), quarterMonths)
                            .whereRaw(`EXTRACT(YEAR FROM ${dateCol}) = ?`, [taxPeriod.year]);
                    } else {
                        purchaseQuery = purchaseQuery
                            .whereRaw(`EXTRACT(MONTH FROM ${dateCol}) = ?`, [taxPeriod.month])
                            .whereRaw(`EXTRACT(YEAR FROM ${dateCol}) = ?`, [taxPeriod.year]);
                    }
                }
                purchaseInvoices = await purchaseQuery;
            }

            console.log(`[MatchingTask] Fetched ${purchaseInvoices.length} source invoices (${is2aVs2b ? 'GSTR-2A' : (is2a ? 'Items' : 'Vouchers')})`);

            // For portal-to-portal runs, we need to ensure the source invoices (2A) have consistent column names for matching
            if (is2aVs2b) {
                purchaseInvoices.forEach(inv => {
                    inv._taxable_val = parseFloat(inv.taxable_value) || 0;
                    inv._total_tax = parseFloat(inv.total_tax) || 0;
                    inv._document_val = parseFloat(inv.document_value) || 0;
                });
            }

            // 3. Fetch GSTR invoices (Source B)
            const portalTypeLabel = is2aVs2b ? 'GSTR-2B' : (is2a ? 'GSTR-2A' : 'GSTR-2B');
            const sourcePrefix = is2aVs2b ? 'gstr_2b%' : (is2a ? 'gstr_2a%' : 'gstr_2b%');
            const gstrTable = is2aVs2b ? 'normalized_gstr2b_invoices' : (is2a ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices');

            await progressEmitter.emitProgress(runId, 30, `Fetching ${portalTypeLabel} invoices...`);
            let gstrQuery = trx(gstrTable)
                .select(`${gstrTable}.*`)
                .where({ [`${gstrTable}.workspace_id`]: workspaceId })
                .where(`${gstrTable}.source_table`, 'like', sourcePrefix);

            // Filter by document date if we have the period details
            if (taxPeriod) {
                const isQuarterly = workspace?.filing_type === 'q';
                if (isQuarterly && taxPeriod.quarter) {
                    let quarterMonths = [];
                    if (taxPeriod.quarter === 1) quarterMonths = [4, 5, 6];
                    else if (taxPeriod.quarter === 2) quarterMonths = [7, 8, 9];
                    else if (taxPeriod.quarter === 3) quarterMonths = [10, 11, 12];
                    else if (taxPeriod.quarter === 4) quarterMonths = [1, 2, 3];

                    gstrQuery = gstrQuery
                        .whereIn(trx.raw(`EXTRACT(MONTH FROM ${gstrTable}.document_date)`), quarterMonths)
                        .whereRaw(`EXTRACT(YEAR FROM ${gstrTable}.document_date) = ?`, [taxPeriod.year]);
                } else {
                    gstrQuery = gstrQuery
                        .whereRaw(`EXTRACT(MONTH FROM ${gstrTable}.document_date) = ?`, [taxPeriod.month])
                        .whereRaw(`EXTRACT(YEAR FROM ${gstrTable}.document_date) = ?`, [taxPeriod.year]);
                }
            }

            const gstrInvoices = await gstrQuery;
            console.log(`[MatchingTask] Fetched ${gstrInvoices.length} ${portalTypeLabel} invoices`);


            // 4. Perform matching
            await progressEmitter.emitProgress(runId, 45, 'Performing rule-based matching...');
            const matchResults = [];
            const matchedGstrIds = new Set();
            const unmatchedPurchases = [];
            let matchedCount = 0;
            let mismatchedCount = 0;
            let missingCount = 0;

            // Step 0: Include all invoices for matching (bypassing strict GSTIN filter for IMPG)
            const validPurchaseInvoices = purchaseInvoices;
            const validGstrInvoices = gstrInvoices;

            const mapCategory = (booksType) => {
                const type = (booksType || '').toString().toUpperCase();
                if (type.includes('CREDIT')) return 'CREDIT_NOTE';
                if (type.includes('DEBIT')) return 'DEBIT_NOTE';
                if (type.includes('IMPORT') || type.includes('BOE')) return 'IMPORT';
                if (type.includes('ISD')) return 'ISD';
                return 'INVOICE';
            };

            const createMatchResult = (overrides) => {
                return {
                    recon_run_id: runId,
                    workspace_id: workspaceId,
                    purchase_invoice_id: is2aVs2b ? null : (overrides.purchase_invoice_id || null),
                    gstr2a_source_id: overrides.gstr2a_source_id || null,
                    gstr2b_invoice_id: overrides.gstr2b_invoice_id || null,
                    gstr2a_invoice_id: overrides.gstr2a_invoice_id || null,
                    match_status: 'unmatched',
                    match_score: 0.00,
                    match_confidence: 'LOW',
                    matched_by: 'RULE',
                    books_value: 0,
                    portal_value: 0,
                    variance_amount: 0,
                    itc_decision: 'PENDING',
                    decision_reason: null,
                    action_required: null,
                    action_priority: 'MEDIUM',
                    action_status: 'pending',
                    created_at: knex.fn.now(),
                    updated_at: knex.fn.now(),
                    ai_confidence_score: null,
                    ai_match_reason: null,
                    ...overrides
                };
            };

            // STEP 1: MATCH BY INVOICE NUMBER (STRICT)
            for (const purchaseInv of validPurchaseInvoices) {
                // If it's a 2A vs 2B run, Source A is a portal invoice
                const pInvNo = is2aVs2b ? purchaseInv.document_number_clean : purchaseInv.supplier_invoice_no;
                const pDate = is2aVs2b ? purchaseInv.document_date : purchaseInv.supplier_invoice_date;
                const pNet = is2aVs2b ? (purchaseInv._document_val) : (isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount));
                const pTaxable = is2aVs2b ? (purchaseInv._taxable_val) : (isNaN(parseFloat(purchaseInv.taxable_total)) ? 0 : parseFloat(purchaseInv.taxable_total));
                const pTax = is2aVs2b ? (purchaseInv._total_tax) : ((parseFloat(purchaseInv.total_igst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_sgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cess_amount) || 0));

                if (!pInvNo) {
                    unmatchedPurchases.push(purchaseInv);
                    continue;
                }

                // 1.1 Strict Invoice Number Match
                const gstrInMatches = validGstrInvoices.filter(g =>
                    (g.document_number_clean === pInvNo || g.document_number_raw === pInvNo) &&
                    !matchedGstrIds.has(g.id)
                );

                if (gstrInMatches.length > 0) {
                    const bestMatch = gstrInMatches[0];
                    matchedGstrIds.add(bestMatch.id);
                    matchedCount++;

                    const gstrTaxable = parseFloat(bestMatch.taxable_value) || 0;
                    const gstrTotalTax = parseFloat(bestMatch.total_tax) || 0;

                    const matchResult = createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : purchaseInv.id,
                        gstr2a_invoice_id: is2aVs2b ? purchaseInv.id : (is2a ? bestMatch.id : null),
                        gstr2b_invoice_id: is2aVs2b ? bestMatch.id : (is2a ? null : bestMatch.id),
                        match_status: 'matched',
                        match_score: 100.00,
                        match_confidence: 'HIGH',
                        books_value: pTax,
                        portal_value: gstrTotalTax,
                        variance_amount: Math.abs(pTax - gstrTotalTax),
                        decision_reason: 'Strict Invoice Number Match'
                    });
                    matchResults.push(matchResult);
                    continue;
                }

                const pDateObj = new Date(pDate);
                const pNormalizedInv = this.normalizeInvoiceNumber(pInvNo);
                const pCategory = mapCategory(purchaseInv.voucher_type || purchaseInv.document_category);

                let matchType = null;
                const match = validGstrInvoices.find(gstrInv => {
                    if (matchedGstrIds.has(gstrInv.id)) return false;

                    const gCategory = gstrInv.document_category || 'INVOICE';

                    // 1. GSTIN Match (Bypass for IMPORT)
                    const pGstin = this.normalizeGstin(purchaseInv.supplier_gstin || purchaseInv.ctin);
                    const gGstin = this.normalizeGstin(gstrInv.supplier_gstin || gstrInv.ctin);
                    const gstinMatch = (pGstin && gGstin && pGstin === gGstin);

                    if (!gstinMatch && gCategory !== 'IMPORT') return false;

                    // 2. Category Match
                    if (!this.areCategoriesCompatible(pCategory, gCategory)) return false;

                    // 3. Invoice Number Match (Including Amendment check)
                    const gNormalizedInv = this.normalizeInvoiceNumber(gstrInv.document_number_clean || gstrInv.document_number_raw);
                    const gOriginalInv = this.normalizeInvoiceNumber(gstrInv.original_invoice_number);
                    const invMatch = (pNormalizedInv === gNormalizedInv) || (gOriginalInv && pNormalizedInv === gOriginalInv);

                    if (!invMatch) return false;

                    const gNet = isNaN(parseFloat(gstrInv.document_value)) ? 0 : parseFloat(gstrInv.document_value);
                    const gTaxable = isNaN(parseFloat(gstrInv.taxable_value)) ? 0 : parseFloat(gstrInv.taxable_value);
                    const gTax = (parseFloat(gstrInv.igst) || 0) +
                        (parseFloat(gstrInv.central_tax || gstrInv.cgst) || 0) +
                        (parseFloat(gstrInv.state_ut_tax || gstrInv.sgst) || 0) +
                        (parseFloat(gstrInv.cess) || 0);
                    const gDate = new Date(gstrInv.document_date);

                    const dateDiff = Math.abs((pDateObj - gDate) / (1000 * 60 * 60 * 24));
                    const exactDate = dateDiff === 0;

                    // Use absolute values for amount matching to handle sign differences (Books vs Portal)
                    const exactTaxable = Math.abs(Math.abs(pTaxable) - Math.abs(gTaxable)) < 0.01;
                    const exactTax = Math.abs(Math.abs(pTax) - Math.abs(gTax)) < 0.01;

                    // Store calculated tax on the object for later use in result saving
                    gstrInv._calculated_tax = gTax;

                    // Case 1: Exact Match
                    if (exactDate && exactTaxable && exactTax) {
                        matchType = 'MATCHED';
                        return true;
                    }

                    // Case 2: Partial Match / Mismatch
                    const diffDays = (pDateObj - gDate) / (1000 * 60 * 60 * 24);
                    const diffTaxable = pTaxable - gTaxable;
                    const diffTax = pTax - gTax;

                    const dateNear = diffDays >= -VAR_DAYS_MAX && diffDays <= VAR_DAYS_MIN;
                    const taxableNear = diffTaxable >= -(VAR_TAXABLE_MAX + 0.01) && diffTaxable <= (VAR_TAXABLE_MIN + 0.01);
                    const taxNear = diffTax >= -(VAR_TAX_MAX + 0.01) && diffTax <= (VAR_TAX_MIN + 0.01);

                    if (dateNear && taxableNear && taxNear) {
                        // Within tolerance: treat as MATCHED (invoice number matched, amounts within tolerance)
                        matchType = 'MATCHED';
                        if (!exactDate || !exactTaxable || !exactTax) {
                            let r = [];
                            if (!exactTax) r.push(`tax ±${Math.abs(diffTax).toFixed(2)} rs`);
                            if (!exactDate) r.push(`date ±${Math.abs(diffDays)} days`);
                            if (!exactTaxable) r.push(`taxable ±${Math.abs(diffTaxable).toFixed(2)} rs`);
                            gstrInv._tolerance_reason = `Matched within tolerance: ${r.join(', ')}`;
                        }
                        return true;
                    }

                    return false;
                });

                if (match) {
                    matchedGstrIds.add(match.id);
                    const isEligible = match.itc_available !== false && match.itc_eligibility !== 'No' && match.itc_eligibility !== 'N';

                    let finalStatus = isEligible ? matchType.toLowerCase() : 'not_eligible';
                    if (finalStatus === 'matched') matchedCount++;
                    else if (finalStatus === 'mismatch') mismatchedCount++;

                    matchResults.push(createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : purchaseInv.id,
                        gstr2a_invoice_id: is2aVs2b ? purchaseInv.id : (is2a ? match.id : null),
                        gstr2b_invoice_id: is2aVs2b ? match.id : (is2a ? null : match.id),
                        match_status: finalStatus,
                        match_score: finalStatus === 'matched' ? 100.00 : (finalStatus === 'not_eligible' ? 0 : 70.00),
                        match_confidence: finalStatus === 'matched' ? 'HIGH' : 'MEDIUM',
                        books_value: pTax,
                        portal_value: match._calculated_tax || 0,
                        variance_amount: pTax - (match._calculated_tax || 0),
                        itc_decision: isEligible ? (finalStatus === 'matched' ? 'ELIGIBLE' : 'PENDING') : 'INELIGIBLE',
                        decision_reason: !isEligible ? 'ITC Not Available in GSTR2B' : (match._tolerance_reason || (finalStatus === 'matched' ? 'Exact match found' : 'Partial match / variance detected')),
                        action_required: !isEligible ? 'REVIEW_ELIGIBILITY' : (finalStatus === 'mismatch' || finalStatus === 'partial_match' ? 'REVIEW_AMOUNT' : null)
                    }));

                } else {
                    unmatchedPurchases.push(purchaseInv);
                }
            }

            // STEP 2: MATCH BY AMOUNT + DATE (FALLBACK FOR UNMATCHED)
            const remainingPurchases = [];
            for (const purchaseInv of unmatchedPurchases) {
                const pNet = isNaN(parseFloat(purchaseInv.net_amount)) ? 0 : parseFloat(purchaseInv.net_amount);
                const pTaxable = isNaN(parseFloat(purchaseInv.taxable_total)) ? 0 : parseFloat(purchaseInv.taxable_total);
                const pTax = (parseFloat(purchaseInv.total_igst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_sgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cess_amount) || 0);

                const pDate = new Date(purchaseInv.supplier_invoice_date);
                const pCategory = mapCategory(purchaseInv.voucher_type);

                let matchType = null;
                const match = validGstrInvoices.find(gstrInv => {
                    if (matchedGstrIds.has(gstrInv.id)) return false;

                    const gCategory = gstrInv.document_category || 'INVOICE';

                    // 1. GSTIN Match (Bypass for IMPORT)
                    const pGstin = this.normalizeGstin(purchaseInv.supplier_gstin);
                    const gGstin = this.normalizeGstin(gstrInv.supplier_gstin);
                    const gstinMatch = (pGstin && gGstin && pGstin === gGstin);

                    if (!gstinMatch && gCategory !== 'IMPORT') return false;

                    // 2. Category Match
                    if (!this.areCategoriesCompatible(pCategory, gCategory)) return false;

                    // 3. Amount + Date Match (Fuzzy)
                    const gNet = isNaN(parseFloat(gstrInv.document_value)) ? 0 : parseFloat(gstrInv.document_value);
                    const gTaxable = isNaN(parseFloat(gstrInv.taxable_value)) ? 0 : parseFloat(gstrInv.taxable_value);
                    const gTax = (parseFloat(gstrInv.igst) || 0) +
                        (parseFloat(gstrInv.central_tax || gstrInv.cgst) || 0) +
                        (parseFloat(gstrInv.state_ut_tax || gstrInv.sgst) || 0) +
                        (parseFloat(gstrInv.cess) || 0);
                    const gDate = new Date(gstrInv.document_date);

                    const dateDiff = Math.abs((pDate - gDate) / (1000 * 60 * 60 * 24));
                    const diffTaxable = Math.abs(Math.abs(pTaxable) - Math.abs(gTaxable));
                    const diffTax = Math.abs(Math.abs(pTax) - Math.abs(gTax));

                    // Store calculated tax
                    gstrInv._calculated_tax = gTax;

                    // Thresholds for fuzzy matching
                    const dateNear = dateDiff <= 30; // Within 30 days
                    const taxableMatch = diffTaxable < (VAR_TAXABLE_MAX + 1);
                    const taxMatch = diffTax < (VAR_TAX_MAX + 1);

                    if (dateNear && taxableMatch && taxMatch) {
                        matchType = (dateDiff === 0 && diffTaxable < 0.01) ? 'PARTIAL_MATCH' : 'PARTIAL_MATCH';
                        gstrInv._partial_reason = `Fuzzy Match: Invoice number mismatch, but matched by amount and date (+/- 30 days)`;
                        return true;
                    }

                    return false;
                });

                if (match) {
                    matchedGstrIds.add(match.id);
                    const isEligible = match.itc_available !== false && match.itc_eligibility !== 'No' && match.itc_eligibility !== 'N';

                    let finalStatus = isEligible ? matchType.toLowerCase() : 'not_eligible';
                    if (finalStatus === 'matched' || finalStatus === 'tolerance_match') matchedCount++;
                    else if (finalStatus === 'mismatch' || finalStatus === 'partial_match') mismatchedCount++;

                    matchResults.push(createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : purchaseInv.id,
                        gstr2a_invoice_id: is2aVs2b ? purchaseInv.id : (is2a ? match.id : null),
                        gstr2b_invoice_id: is2aVs2b ? match.id : (is2a ? null : match.id),
                        match_status: finalStatus,
                        match_score: finalStatus === 'matched' ? 90.00 : (finalStatus === 'partial_match' ? 80.00 : 60.00),
                        match_confidence: 'LOW',
                        matched_by: 'FUZZY',
                        books_value: pTax,
                        portal_value: match._calculated_tax || 0,
                        variance_amount: pTax - (match._calculated_tax || 0),
                        itc_decision: isEligible ? 'PENDING' : 'INELIGIBLE',
                        decision_reason: !isEligible ? 'ITC Not Available in GSTR2B' : (match._partial_reason || `Fuzzy Match: Matched by amount and date (+/- 30 days)`),
                        action_required: 'REVIEW_MATCH'
                    }));
                } else {
                    remainingPurchases.push(purchaseInv);
                }
            }

            // 4c. Process unmatched purchases
            for (const purchaseInv of remainingPurchases) {
                const pTaxAmount = (parseFloat(purchaseInv.total_igst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_sgst_amount) || 0) +
                    (parseFloat(purchaseInv.total_cess_amount) || 0);
                matchResults.push(createMatchResult({
                    purchase_invoice_id: is2aVs2b ? null : purchaseInv.id,
                    gstr2a_invoice_id: is2aVs2b ? purchaseInv.id : null,
                    match_status: 'missing_in_portal',
                    match_score: 0.00,
                    match_confidence: 'HIGH',
                    matched_by: 'RULE',
                    books_value: pTaxAmount,
                    variance_amount: pTaxAmount,
                    itc_decision: 'INELIGIBLE',
                    decision_reason: `Not found in ${is2a ? 'GSTR2A' : 'GSTR2B'}`,
                    action_required: 'FOLLOW_UP_SUPPLIER',
                    action_priority: 'HIGH'
                }));
                missingCount++;
            }

            // 4d. Unmatched GSTR-2B invoices
            for (const gstrInv of validGstrInvoices) {
                if (!matchedGstrIds.has(gstrInv.id)) {
                    const gTaxAmount = parseFloat(gstrInv.total_tax) || ((parseFloat(gstrInv.igst) || 0) +
                        (parseFloat(gstrInv.central_tax || gstrInv.cgst) || 0) +
                        (parseFloat(gstrInv.state_ut_tax || gstrInv.sgst) || 0) +
                        (parseFloat(gstrInv.cess) || 0));
                    const isEligible = gstrInv.itc_available !== false && gstrInv.itc_eligibility !== 'No' && gstrInv.itc_eligibility !== 'N';

                    matchResults.push(createMatchResult({
                        gstr2b_invoice_id: gstrInv.id,
                        match_status: isEligible ? 'missing_in_books' : 'not_eligible',
                        match_score: 0.00,
                        match_confidence: 'HIGH',
                        matched_by: 'RULE',
                        portal_value: gTaxAmount,
                        variance_amount: -gTaxAmount,
                        itc_decision: isEligible ? 'PENDING' : 'INELIGIBLE',
                        decision_reason: isEligible ? 'Not found in records' : `ITC Not Available in ${is2a ? 'GSTR2A' : 'GSTR2B'}`,
                        action_required: isEligible ? 'ADD_TO_BOOKS' : 'REVIEW_ELIGIBILITY',
                        action_priority: 'MEDIUM'
                    }));
                    missingCount++;
                }
            }

            if (matchResults.length > 0) {
                await progressEmitter.emitProgress(runId, 85, 'Saving reconciliation results...');

                // collection of invoice IDs to clear previous results
                const purchaseIds = matchResults.map(r => r.purchase_invoice_id).filter(id => id);
                const gstr2bIds = matchResults.map(r => r.gstr2b_invoice_id).filter(id => id);
                const gstr2aIds = matchResults.map(r => r.gstr2a_invoice_id).filter(id => id);
                const gstr2aSourceIds = matchResults.map(r => r.gstr2a_source_id).filter(id => id);

                // --- 1. Prevent Duplicates: Delete existing results for these invoices in this workspace ---
                if (purchaseIds.length > 0 || gstr2bIds.length > 0 || gstr2aIds.length > 0 || gstr2aSourceIds.length > 0) {
                    const deleteQuery = trx('reconciliation_results')
                        .where('workspace_id', workspaceId)
                        .where(function () {
                            if (purchaseIds.length > 0) this.whereIn('purchase_invoice_id', purchaseIds);
                            if (gstr2bIds.length > 0) this.orWhereIn('gstr2b_invoice_id', gstr2bIds);
                            if (gstr2aIds.length > 0) this.orWhereIn('gstr2a_invoice_id', gstr2aIds);
                            if (gstr2aSourceIds.length > 0) this.orWhereIn('gstr2a_source_id', gstr2aSourceIds);
                        })
                        .whereIn('recon_run_id', function () {
                            this.select('id').from('reconciliation_runs')
                                .where('run_type', 'PURCHASE_2B');
                        });

                    const deletedCount = await deleteQuery.delete();
                    if (deletedCount > 0) {
                        console.log(`[Recon Task] Cleared ${deletedCount} existing results for run ${runId}`);
                    }
                }

                // --- 2. Insert New Results ---
                const insertedResults = await trx('reconciliation_results').insert(matchResults).returning('*');

                // ── 3. Auto-populate/Update reconciliation_status table ──────────────────────────
                await progressEmitter.emitProgress(runId, 90, 'Updating reconciliation status...');
                const workspaceData = await trx('workspaces').where({ id: workspaceId }).first();
                const tenantId = workspaceData?.tenant_id || workspaceId;

                const statusRows = insertedResults
                    .filter(r => r.purchase_invoice_id || r.gstr2b_invoice_id || r.gstr2a_invoice_id || r.gstr2a_source_id)
                    .map(r => ({
                        workspace_id: workspaceId,
                        tenant_id: tenantId,
                        book_data_id: r.purchase_invoice_id || null,
                        book_data_type: r.purchase_invoice_id ? 'purchase_voucher' : (r.gstr2a_source_id ? 'gstr2a_source' : null),
                        gstr_data_id: r.gstr2b_invoice_id || r.gstr2a_invoice_id || null,
                        gstr_type: (r.gstr2b_invoice_id || r.gstr2a_invoice_id) ? (r.gstr2a_invoice_id ? 'gstr2a' : 'gstr2b') : null,
                        recon_status: 'pending',
                        status: 'Active',
                        // added_date: knex.fn.now(), // Only for new records
                        updated_date: knex.fn.now(),
                        extra_info: JSON.stringify({
                            recon_result_id: r.id,
                            match_status: r.match_status,
                            match_score: r.match_score,
                            decision_reason: r.decision_reason,
                            recon_run_id: runId
                        })
                    }));

                // Process in batches, updating existing records or matching new ones
                for (const row of statusRows) {
                    const existing = row.book_data_id
                        ? await trx('reconciliation_status')
                            .where({ workspace_id: workspaceId, book_data_id: row.book_data_id })
                            .first()
                        : await trx('reconciliation_status')
                            .where({ workspace_id: workspaceId, gstr_data_id: row.gstr_data_id })
                            .first();

                    if (existing) {
                        // Update existing status with latest result reference
                        await trx('reconciliation_status')
                            .where({ id: existing.id })
                            .update({
                                book_data_id: row.book_data_id,
                                gstr_data_id: row.gstr_data_id,
                                gstr_type: row.gstr_type,
                                extra_info: row.extra_info,
                                updated_date: row.updated_date
                                // Note: we DON'T override recon_status if it's already claimed/mismatched
                            });
                    } else {
                        // Insert new status
                        await trx('reconciliation_status').insert({
                            ...row,
                            added_date: knex.fn.now()
                        });
                    }
                }
            }

            await trx('reconciliation_runs')
                .where({ id: runId })
                .update({
                    status: 'COMPLETED',
                    total_invoices: purchaseInvoices.length + gstrInvoices.length,
                    matched_count: matchedCount,
                    mismatched_count: mismatchedCount,
                    missing_count: missingCount,
                    completed_at: knex.fn.now(),
                    result_summary: JSON.stringify({
                        purchase_vouchers: purchaseInvoices.length,
                        [is2a ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices']: gstrInvoices.length,
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
        const run_type = filters.run_type || filters.type;
        const page = pagination.page || parseInt(filters.page) || 1;
        const page_size = pagination.page_size || parseInt(filters.page_size) || 20;
        const offset = (page - 1) * page_size;

        const query = knex('reconciliation_runs')
            .where({ workspace_id: workspaceId });

        if (gstin_id) query.where({ gstin_id });
        if (period_id) query.where({ period_id });
        if (status) query.where({ status });
        if (run_type) query.where({ run_type });

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
            workflow_status,
            page = 1,
            page_size = 50,
            export_mode,
            period,
            fy,
            quarter,
            month,
            column_filters, // Object like { gstin: '...', invoice_no: '...' }
            sort_by = 'created_at',
            sort_order = 'desc'
        } = filters;

        // Verify run belongs to workspace
        let run;
        if (runId === 'all') {
            run = { run_type: filters.run_type || filters.type || 'PURCHASE_2B' }; // Respect provided run_type or type filter
        } else {
            run = await this.getRunById(workspaceId, runId);
        }
        if (!run) return null;

        const is2a = run.run_type === 'PURCHASE_2A';
        const is2aVs2b = run.run_type === 'PURCHASE_2A_VS_2B';
        const gstrTable = (is2a || is2aVs2b) ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices';
        const gstrIdCol = (is2a || is2aVs2b) ? 'gstr2a_invoice_id' : 'gstr2b_invoice_id';

        let query = knex('reconciliation_results as rr')
            .leftJoin(`${gstrTable} as gi`, `rr.${gstrIdCol}`, 'gi.id');

        if (is2aVs2b) {
            // For 2A vs 2B, join the "Source A" portal table (using gstr2a_source_id)
            // Note: gstrTable above is for gi (Source B). For 2A vs 2B, Source B is 2B. 
            // Wait, the logic I used in runMatchingTask was:
            // Source A = validPurchaseInvoices (which are 2A if is2aVs2b)
            // Source B = validGstrInvoices (which are 2B if is2aVs2b)

            // Re-evaluating gstrTable for gi (Source B)
            const sourceBTable = is2aVs2b ? 'normalized_gstr2b_invoices' : (is2a ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices');
            const sourceBIdCol = is2aVs2b ? 'gstr2b_invoice_id' : (is2a ? 'gstr2a_invoice_id' : 'gstr2b_invoice_id');

            query = knex('reconciliation_results as rr')
                .leftJoin(`${sourceBTable} as gi`, `rr.${sourceBIdCol}`, 'gi.id')
                .leftJoin('normalized_gstr2a_invoices as sa', 'rr.gstr2a_source_id', 'sa.id');
        } else if (is2a) {
            // For GSTR-2A, we need to join with aggregated purchase_items
            const purchaseSummary = knex('purchase_items')
                .select('purchase_id')
                .sum('taxable_amount as taxable_total')
                .sum('igst_amount as total_igst_amount')
                .sum('cgst_amount as total_cgst_amount')
                .sum('sgst_amount as total_sgst_amount')
                .sum('cess_amount as total_cess_amount')
                .sum('total_amount_with_tax as net_amount')
                .groupBy('purchase_id')
                .as('ps');

            query = query
                .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
                .leftJoin(purchaseSummary, 'pi.id', 'ps.purchase_id');
        } else {
            query = query
                .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id');
        }

        if (!is2aVs2b) {
            query = query.leftJoin('tax_periods as tp', function () {
                this.on('tp.id', '=', 'pi.tax_period_id')
                    .orOn(function () {
                        this.on('tp.period_code', '=', 'gi.return_period')
                            .andOnNull('pi.tax_period_id');
                    });
            });
        }

        // Join with financial_years if available
        if (!is2aVs2b) {
            query = query.leftJoin('financial_years as fymas', 'tp.fy_id', 'fymas.id');
        }

        // Join with reconciliation_status table to get the workflow status
        // For 2A vs 2B, we use gstr2a_source_id and gstr2b_invoice_id for status tracking
        if (is2aVs2b) {
            query = query
                .leftJoin('reconciliation_status as rs_pi', 'rr.gstr2a_source_id', 'rs_pi.gstr_data_id')
                .leftJoin('reconciliation_status as rs_gi', 'rr.gstr2b_invoice_id', 'rs_gi.gstr_data_id');
        } else {
            query = query
                .leftJoin('reconciliation_status as rs_pi', 'rr.purchase_invoice_id', 'rs_pi.book_data_id')
                .leftJoin('reconciliation_status as rs_gi', `rr.${gstrIdCol}`, 'rs_gi.gstr_data_id');
        }

        query = query.leftJoin('supplier_master as sm', function () {
            if (is2aVs2b) {
                this.on('sm.gstin', '=', knex.raw('COALESCE(sa.supplier_gstin, gi.supplier_gstin)'))
                    .andOn('sm.workspace_id', '=', 'rr.workspace_id');
            } else {
                this.on('sm.gstin', '=', knex.raw('COALESCE(pi.supplier_gstin, gi.supplier_gstin)'))
                    .andOn('sm.workspace_id', '=', 'rr.workspace_id');
            }
        });

        // Apply Run ID filter ONLY if status is not 'pending'
        // If status is 'pending', we show all historical pending data for the workspace
        if (workflow_status === 'pending') {
            query.where('rr.workspace_id', workspaceId)
                .join('reconciliation_runs as run_isolation', 'rr.recon_run_id', 'run_isolation.id')
                .where('run_isolation.run_type', run.run_type);
        } else {
            query.where('rr.recon_run_id', runId);
        }

        // Hide records where GSTIN is missing (as per user request "else hide the data")
        query.where(function () {
            if (is2aVs2b) {
                this.whereNotNull('sa.supplier_gstin')
                    .orWhereNotNull('gi.supplier_gstin');
            } else {
                this.whereNotNull('pi.supplier_gstin')
                    .orWhereNotNull('gi.supplier_gstin');
            }
        }).andWhere(function () {
            if (is2aVs2b) {
                this.where('sa.supplier_gstin', '!=', '')
                    .orWhere('gi.supplier_gstin', '!=', '');
            } else {
                this.where('pi.supplier_gstin', '!=', '')
                    .orWhere('gi.supplier_gstin', '!=', '');
            }
        });

        // --- Apply Filters ---
        if (match_status && match_status !== 'all' && match_status !== 'ALL') {
            const statusList = Array.isArray(match_status) ? match_status : match_status.split(',').map(s => s.trim());
            query.whereIn('rr.match_status', statusList);
        }

        if (workflow_status && workflow_status !== 'all' && workflow_status !== 'ALL') {
            const statusList = Array.isArray(workflow_status) ? workflow_status : workflow_status.split(',').map(s => s.trim());
            if (statusList.includes('pending')) {
                // For pending, we show rows where status is either explicitly 'pending' or NULL
                query.where(function () {
                    this.whereIn(knex.raw('COALESCE(rs_pi.recon_status, rs_gi.recon_status, \'pending\')'), statusList);
                });
            } else {
                query.where(function () {
                    this.whereIn('rs_pi.recon_status', statusList)
                        .orWhereIn('rs_gi.recon_status', statusList);
                });
            }
        }

        if (action_required && action_required !== 'false') {
            query.whereNotNull('rr.action_required');
        }

        if (supplier_gstin) {
            const gstinList = Array.isArray(supplier_gstin) ? supplier_gstin : supplier_gstin.split(',').map(s => s.trim());
            query.where(function () {
                if (is2aVs2b) {
                    this.whereIn('sa.supplier_gstin', gstinList)
                        .orWhereIn('gi.supplier_gstin', gstinList);
                } else {
                    this.whereIn('pi.supplier_gstin', gstinList)
                        .orWhereIn('gi.supplier_gstin', gstinList);
                }
            });
        }

        if (date_from) {
            query.where(function () {
                if (is2aVs2b) {
                    this.where('sa.document_date', '>=', date_from)
                        .orWhere('gi.document_date', '>=', date_from);
                } else {
                    this.where('pi.supplier_invoice_date', '>=', date_from)
                        .orWhere('gi.document_date', '>=', date_from);
                }
            });
        }

        if (date_to) {
            query.where(function () {
                if (is2aVs2b) {
                    this.where('sa.document_date', '<=', date_to)
                        .orWhere('gi.document_date', '<=', date_to);
                } else {
                    this.where('pi.supplier_invoice_date', '<=', date_to)
                        .orWhere('gi.document_date', '<=', date_to);
                }
            });
        }

        if (place_of_supply) {
            const states = place_of_supply.split(',').map(s => s.trim());
            query.where(function () {
                if (is2aVs2b) {
                    this.whereIn('sa.place_of_supply', states)
                        .orWhereIn('gi.place_of_supply', states)
                        .orWhereIn('sa.place_of_supply', knex('state_code_master').select('state').whereIn('code', states))
                        .orWhereIn('gi.place_of_supply', knex('state_code_master').select('state').whereIn('code', states));
                } else {
                    this.whereIn('pi.place_of_supply', states)
                        .orWhereIn('gi.place_of_supply', states)
                        .orWhereIn('pi.place_of_supply', knex('state_code_master').select('state').whereIn('code', states))
                        .orWhereIn('gi.place_of_supply', knex('state_code_master').select('state').whereIn('code', states));
                }
            });
        }

        // Robust numeric filter handling to prevent 500 errors with "undefined" strings
        const isValidNumeric = (val) => val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val)) && isFinite(val);

        if (isValidNumeric(min_amount)) {
            const min = parseFloat(min_amount);
            query.where(function () {
                if (is2aVs2b) {
                    this.where('sa.document_value', '>=', min)
                        .orWhere('gi.document_value', '>=', min);
                } else {
                    this.where('pi.net_amount', '>=', min)
                        .orWhere('gi.document_value', '>=', min);
                }
            });
        }

        if (isValidNumeric(max_amount)) {
            const max = parseFloat(max_amount);
            query.where(function () {
                if (is2aVs2b) {
                    this.where('sa.document_value', '<=', max)
                        .orWhere('gi.document_value', '<=', max);
                } else {
                    this.where('pi.net_amount', '<=', max)
                        .orWhere('gi.document_value', '<=', max);
                }
            });
        }

        if (has_variance === 'true') {
            query.where('rr.variance_amount', '!=', 0);
        }

        // --- Period Filtering: Exact Month / Quarter / FY on invoice dates ---
        // We filter directly on the actual invoice/document date columns so that
        // a record with invoice_date = 15/04/2025 correctly appears when Month=April is selected.
        const isPendingView = workflow_status === 'pending';
        const hasPeriodFilter = (fy && fy !== 'ALL') || (month && month !== 'ALL') || (quarter && quarter !== 'ALL');

        if (hasPeriodFilter) {
            // Resolve year from FY code (e.g. "2025-26" → start year 2025)
            let filterYear = null;
            if (fy && fy !== 'ALL') {
                if (fy.includes('-')) {
                    // "2025-26" → year depends on month (Apr-Dec = 2025, Jan-Mar = 2026)
                    filterYear = parseInt(fy.split('-')[0]);
                } else {
                    filterYear = parseInt(fy);
                }
            }

            // Calculate ending date for cumulative pending view
            let endDate = null;
            if (isPendingView) {
                if (month && month !== 'ALL') {
                    const m = parseInt(month);
                    let yearForMonth = filterYear;
                    if (filterYear && m >= 1 && m <= 3) yearForMonth = filterYear + 1;
                    if (yearForMonth) endDate = new Date(yearForMonth, m, 0);
                } else if (quarter && quarter !== 'ALL') {
                    const q = parseInt(quarter);
                    const lastMonthOfQ = { 1: 6, 2: 9, 3: 12, 4: 3 }[q];
                    let yearForQ = (q === 4 && filterYear) ? filterYear + 1 : filterYear;
                    if (yearForQ) endDate = new Date(yearForQ, lastMonthOfQ, 0);
                } else if (filterYear) {
                    endDate = new Date(filterYear + 1, 3, 0); // End of FY
                }
            }

            if (isPendingView && endDate) {
                const dateStr = endDate.toISOString().split('T')[0];
                query.where(function () {
                    if (is2aVs2b) {
                        this.where(knex.raw('COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)'), '<=', dateStr);
                    } else {
                        this.where(knex.raw('COALESCE(pi.supplier_invoice_date, pi.book_vchr_date, gi.document_date, gi.isd_document_date, gi.boe_date)'), '<=', dateStr);
                    }
                });
            } else {
                query.where(function () {
                    const self = this;

                    if (month && month !== 'ALL') {
                        const m = parseInt(month);
                        // For Indian FY: April (4) – December (12) → start year; Jan (1) – Mar (3) → start year + 1
                        let yearForMonth = filterYear;
                        if (filterYear && m >= 1 && m <= 3) {
                            yearForMonth = filterYear + 1;
                        }

                        self.where(function () {
                            // Books / Source A invoice date
                            if (is2aVs2b) {
                                this.whereRaw('EXTRACT(MONTH FROM COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)) = ?', [m]);
                                if (yearForMonth) {
                                    this.andWhereRaw('EXTRACT(YEAR FROM COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)) = ?', [yearForMonth]);
                                }
                            } else {
                                this.whereRaw('EXTRACT(MONTH FROM COALESCE(pi.supplier_invoice_date, pi.book_vchr_date, gi.document_date, gi.isd_document_date, gi.boe_date)) = ?', [m]);
                                if (yearForMonth) {
                                    this.andWhereRaw('EXTRACT(YEAR FROM COALESCE(pi.supplier_invoice_date, pi.book_vchr_date, gi.document_date, gi.isd_document_date, gi.boe_date)) = ?', [yearForMonth]);
                                }
                            }
                        });
                    } else if (quarter && quarter !== 'ALL') {
                        // Determine which months belong to this quarter (Indian FY)
                        const q = parseInt(quarter);
                        const quarterMonthMap = { 1: [4, 5, 6], 2: [7, 8, 9], 3: [10, 11, 12], 4: [1, 2, 3] };
                        const qMonths = quarterMonthMap[q] || [];

                        self.where(function () {
                            const dateExpr = is2aVs2b
                                ? 'COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)'
                                : 'COALESCE(pi.supplier_invoice_date, pi.book_vchr_date, gi.document_date, gi.isd_document_date, gi.boe_date)';

                            this.whereIn(knex.raw(`EXTRACT(MONTH FROM ${dateExpr})::int`), qMonths);
                            if (filterYear) {
                                const yearForQ = q === 4 ? filterYear + 1 : filterYear;
                                this.andWhereRaw(`EXTRACT(YEAR FROM ${dateExpr}) = ?`, [yearForQ]);
                            }
                        });
                    } else if (filterYear) {
                        // Only FY selected – entire Indian fiscal year (Apr start_year to Mar start_year+1)
                        const startYear = filterYear;
                        const endYear = filterYear + 1;
                        self.where(function () {
                            const dateExpr = is2aVs2b
                                ? 'COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)'
                                : 'COALESCE(pi.supplier_invoice_date, pi.book_vchr_date, gi.document_date, gi.isd_document_date, gi.boe_date)';

                            this.whereRaw(
                                `(EXTRACT(YEAR FROM ${dateExpr}) = ? AND EXTRACT(MONTH FROM ${dateExpr}) >= 4
                                OR EXTRACT(YEAR FROM ${dateExpr}) = ? AND EXTRACT(MONTH FROM ${dateExpr}) <= 3)`,
                                [startYear, endYear]
                            );
                        });
                    }
                });
            }
        } else if (period && period !== 'ALL' && !isPendingView) {
            // Fallback to exact period if no fy/month/quarter specified (legacy behavior)
            let periodToUse = period;
            if (/^\d{4}-\d{2}$/.test(period)) {
                const [year, month] = period.split('-');
                periodToUse = `${month}${year}`;
            }

            query.where(function () {
                this.where('tp.period_code', periodToUse)
                    .orWhere('gi.return_period', periodToUse);
            });
        }

        let parsedColumnFilters = column_filters;
        if (column_filters && typeof column_filters === 'string') {
            try {
                parsedColumnFilters = JSON.parse(column_filters);
            } catch (e) {
                parsedColumnFilters = null;
            }
        }

        if (parsedColumnFilters && typeof parsedColumnFilters === 'object') {
            // Maps frontend filter keys to DB columns
            const colMapping = {
                // Identity
                gstin: { cols: is2aVs2b ? ['sa.supplier_gstin', 'gi.supplier_gstin'] : ['pi.supplier_gstin', 'gi.supplier_gstin'], exact: true },
                name: { cols: is2aVs2b ? ['sa.supplier_name', 'gi.supplier_name'] : ['pi.supplier_name', 'gi.supplier_name'] },
                gst_type: { cols: is2aVs2b ? ['sa.source_section', 'gi.source_section'] : ['pi.source_section', 'gi.source_section'] },
                invoice_no: { cols: is2aVs2b ? ['COALESCE(sa.document_number_clean, gi.document_number_clean, gi.isd_document_number, gi.boe_number)', 'COALESCE(gi.document_number_clean, gi.isd_document_number, gi.boe_number)'] : ['pi.supplier_invoice_no', 'COALESCE(gi.document_number_clean, gi.isd_document_number, gi.boe_number)'] },
                invoice_date: { cols: is2aVs2b ? ['COALESCE(sa.document_date, gi.document_date, gi.isd_document_date, gi.boe_date)', 'COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date)'] : ['COALESCE(pi.supplier_invoice_date, pi.book_vchr_date)', 'COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date)'], dateCol: true },
                voucher_no: { cols: is2aVs2b ? [] : ['pi.book_vchr_no'] },
                gst_cat: { cols: is2aVs2b ? ['sa.source_section'] : ['pi.gstr_category'] },
                voucher_date: { cols: is2aVs2b ? [] : ['pi.book_vchr_date'], dateCol: true },
                // Match status / action
                status: { cols: ['rr.match_status'], exact: true },
                action_status: { cols: [knex.raw("COALESCE(rs_pi.recon_status, rs_gi.recon_status, 'pending')")], exact: true },
                // GSTR amounts (gi / Source B)
                gstr_invoice_total: { cols: [knex.raw('COALESCE(gi.document_value, gi.taxable_value, (COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0)))')], numeric: true },
                gstr_taxable: { cols: ['gi.taxable_value'], numeric: true },
                gstr_tax_rate: { cols: ['gi.tax_rate'], numeric: true },
                gstr2a_tax_rate: { cols: ['gi.tax_rate'], numeric: true },
                gstr_tax: { cols: [knex.raw("COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))")], numeric: true },
                gstr2a_tax_total: { cols: [knex.raw("COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))")], numeric: true },
                gstr_igst: { cols: ['gi.igst'], numeric: true },
                gstr_cgst: { cols: ['gi.cgst'], numeric: true },
                gstr_sgst: { cols: ['gi.sgst'], numeric: true },
                gstr_cess: { cols: ['gi.cess'], numeric: true },
                // Books / Source A amounts
                book_invoice_total: { cols: is2aVs2b ? ['sa.document_value'] : (is2a ? [] : ['pi.net_amount']), numeric: true },
                book_taxable: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')}, 0)`)], numeric: true },
                purchase_tax_rate: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.tax_rate' : (is2a ? 'ps.tax_rate' : 'pi.tax_rate')}, 0)`)], numeric: true },
                book_tax_rate: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.tax_rate' : (is2a ? 'ps.tax_rate' : 'pi.tax_rate')}, 0)`)], numeric: true },
                book_tax: {
                    cols: [knex.raw(is2aVs2b ? `COALESCE(sa.total_tax, COALESCE(sa.igst,0)+COALESCE(sa.cgst,0)+COALESCE(sa.sgst,0)+COALESCE(sa.cess,0))` :
                        `(COALESCE(${is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount'}, 0))`)], numeric: true
                },
                purchase_tax_total: {
                    cols: [knex.raw(is2aVs2b ? `COALESCE(sa.total_tax, COALESCE(sa.igst,0)+COALESCE(sa.cgst,0)+COALESCE(sa.sgst,0)+COALESCE(sa.cess,0))` :
                        `(COALESCE(${is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount'}, 0) + 
                          COALESCE(${is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount'}, 0))`)], numeric: true
                },
                book_igst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.igst' : (is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount')}, 0)`)], numeric: true },
                book_cgst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount')}, 0)`)], numeric: true },
                book_sgst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount')}, 0)`)], numeric: true },
                book_cess: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount')}, 0)`)], numeric: true },
                purchase_igst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.igst' : (is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount')}, 0)`)], numeric: true },
                purchase_cgst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount')}, 0)`)], numeric: true },
                purchase_sgst: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount')}, 0)`)], numeric: true },
                purchase_cess: { cols: [knex.raw(`COALESCE(${is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount')}, 0)`)], numeric: true },
                tax_diff: { cols: ['rr.variance_amount'], numeric: true },
                difference: { cols: ['rr.variance_amount'], numeric: true },
            };

            Object.entries(parsedColumnFilters).forEach(([key, value]) => {
                const isEmpty = !value || (Array.isArray(value) && value.length === 0) || value === '';
                if (isEmpty) return;

                const def = colMapping[key];
                if (!def) return;

                const valueList = Array.isArray(value) ? value.filter(Boolean) : [value];
                if (valueList.length === 0) return;

                if (def.dateCol) {
                    query.where(function () {
                        const self = this;
                        valueList.forEach((v, vi) => {
                            let dbDate = v;
                            const parts = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                            if (parts) dbDate = `${parts[3]}-${parts[2]}-${parts[1]}`;
                            def.cols.forEach((col, ci) => {
                                if (vi === 0 && ci === 0) self.where(knex.raw(`${col}::date = ?`, [dbDate]));
                                else self.orWhere(knex.raw(`${col}::date = ?`, [dbDate]));
                            });
                        });
                    });
                } else if (def.numeric) {
                    query.where(function () {
                        const self = this;
                        valueList.forEach((v, vi) => {
                            const num = parseFloat(v);
                            if (isNaN(num)) return;
                            def.cols.forEach((col, ci) => {
                                const colSql = (col && typeof col === 'object' && col.toSQL) ? col.toSQL().sql : col;
                                if (vi === 0 && ci === 0) self.whereRaw(`ROUND(COALESCE((${colSql})::numeric, 0)::numeric, 2) = ?`, [Math.round(num * 100) / 100]);
                                else self.orWhereRaw(`ROUND(COALESCE((${colSql})::numeric, 0)::numeric, 2) = ?`, [Math.round(num * 100) / 100]);
                            });
                        });
                    });
                } else if (def.exact) {
                    query.where(function () {
                        def.cols.forEach((col, idx) => {
                            const isRaw = col && typeof col === 'object' && col.toSQL;
                            if (isRaw) {
                                const placeholders = valueList.map(() => '?').join(', ');
                                const rawSql = col.toSQL ? col.toSQL().sql : String(col);
                                if (idx === 0) this.whereRaw(`(${rawSql}) IN (${placeholders})`, valueList);
                                else this.orWhereRaw(`(${rawSql}) IN (${placeholders})`, valueList);
                            } else {
                                if (idx === 0) this.whereIn(col, valueList);
                                else this.orWhereIn(col, valueList);
                            }
                        });
                    });
                } else {
                    query.where(function () {
                        def.cols.forEach((col, idx) => {
                            valueList.forEach((v, vi) => {
                                const method = (idx === 0 && vi === 0) ? 'where' : 'orWhere';
                                this[method](col, 'ilike', `%${v}%`);
                            });
                        });
                    });
                }
            });
        }

        if (search) {
            query.where(function () {
                if (is2aVs2b) {
                    this.where('sa.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('gi.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('sa.document_number_clean', 'ilike', `%${search}%`)
                        .orWhere('gi.document_number_clean', 'ilike', `%${search}%`)
                        .orWhere('sa.supplier_gstin', 'ilike', `%${search}%`)
                        .orWhere('gi.supplier_gstin', 'ilike', `%${search}%`);
                } else {
                    this.where('pi.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('gi.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('pi.supplier_invoice_no', 'ilike', `%${search}%`)
                        .orWhere('gi.document_number_clean', 'ilike', `%${search}%`)
                        .orWhere('pi.supplier_gstin', 'ilike', `%${search}%`)
                        .orWhere('gi.supplier_gstin', 'ilike', `%${search}%`);
                }
            });
        }

        // --- Calculate Totals before limit/offset ---
        const totalsQuery = query.clone()
            .clearSelect()
            .select(
                knex.raw(`SUM(COALESCE(gi.taxable_value, 0)) as gstr2b_taxable_total`),
                knex.raw(`SUM(COALESCE(${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')}, 0)) as purchase_taxable_total`),
                knex.raw(`SUM(COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0))) as gstr2b_tax_total`),
                knex.raw(`SUM(COALESCE(${is2aVs2b ? 'sa.total_tax' :
                    (is2a ? '(COALESCE(ps.total_igst_amount, 0) + COALESCE(ps.total_cgst_amount, 0) + COALESCE(ps.total_sgst_amount, 0) + COALESCE(ps.total_cess_amount, 0))' :
                        '(COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0))')}, 0)) as purchase_tax_total`),
                knex.raw('SUM(gi.cgst) as gstr2b_cgst_total'),
                knex.raw('SUM(gi.sgst) as gstr2b_sgst_total'),
                knex.raw('SUM(gi.cess) as gstr2b_cess_total'),
                knex.raw(`SUM(COALESCE(${is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount')}, 0)) as purchase_cgst_total`),
                knex.raw(`SUM(COALESCE(${is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount')}, 0)) as purchase_sgst_total`),
                knex.raw(`SUM(COALESCE(${is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount')}, 0)) as purchase_cess_total`),
                knex.raw('COUNT(*) as total')
            );
        const totalsResult = await totalsQuery.first();
        const total = parseInt(totalsResult.total || 0);

        // --- Calculate filtered counts by status ---
        const statusCountsQuery = query.clone()
            .clearSelect()
            .select('rr.match_status')
            .count('* as count')
            .groupBy('rr.match_status');
        const statusCountsResult = await statusCountsQuery;

        const summary = {
            matched: 0,
            mismatched: 0,
            missing: 0,
            totals: {
                gstr2b_taxable: parseFloat(totalsResult.gstr2b_taxable_total || 0),
                purchase_taxable: parseFloat(totalsResult.purchase_taxable_total || 0),
                gstr2b_tax: parseFloat(totalsResult.gstr2b_tax_total || 0),
                purchase_tax: parseFloat(totalsResult.purchase_tax_total || 0),
                gstr2b_cgst: parseFloat(totalsResult.gstr2b_cgst_total || 0),
                gstr2b_sgst: parseFloat(totalsResult.gstr2b_sgst_total || 0),
                gstr2b_cess: parseFloat(totalsResult.gstr2b_cess_total || 0),
                purchase_cgst: parseFloat(totalsResult.purchase_cgst_total || 0),
                purchase_sgst: parseFloat(totalsResult.purchase_sgst_total || 0),
                purchase_cess: parseFloat(totalsResult.purchase_cess_total || 0)
            }
        };
        statusCountsResult.forEach(row => {
            const status = row.match_status;
            if (status === 'matched') {
                summary.matched = parseInt(row.count);
            } else if (status === 'mismatch') {
                summary.mismatched = parseInt(row.count);
            } else if (['missing_in_2b', 'missing_in_books', 'not_eligible'].includes(status)) {
                summary.missing += parseInt(row.count);
            }
        });

        // --- Prepare Main Query ---
        query.select(
            'rr.id',
            'rr.recon_run_id',
            'rr.workspace_id',
            'rr.match_status',
            'rr.match_score',
            'rr.match_confidence',
            'rr.itc_decision',
            'rr.decision_reason',
            'rr.action_required',
            'rr.action_status',
            'rr.variance_amount',
            'rr.created_at',
            'rr.updated_at',

            // Row identification
            is2aVs2b ? 'sa.id as source_a_id' : 'pi.id as purchase_invoice_id',
            'gi.id as gstr_data_id',

            // Supplier mapping
            is2aVs2b ? knex.raw('COALESCE(sa.supplier_name, gi.supplier_name) as supplier_name') : knex.raw('COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name'),
            is2aVs2b ? knex.raw('COALESCE(sa.supplier_gstin, gi.supplier_gstin) as supplier_gstin') : knex.raw('COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin'),
            'sm.email as supplier_email',

            // --- UNIFIED MIRRORS (Ensures compatibility with any frontend version) ---
            // 1. Invoice Number Mirror (Aggressive Fallbacks)
            knex.raw(`COALESCE(NULLIF(${is2aVs2b ? 'sa.document_number_clean' : 'pi.supplier_invoice_no'}, ''), NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.boe_number) as supplier_invoice_no`),
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.isd_document_number, gi.boe_number) as gstr_invoice_number`),
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.isd_document_number, gi.boe_number) as invoice_no`),
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.isd_document_number, gi.boe_number) as inv_no`),

            // 2. Date Mirror (Aggressive Fallbacks)
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.document_date' : 'pi.supplier_invoice_date'}, gi.document_date, gi.isd_document_date, gi.boe_date) as supplier_invoice_date`),
            knex.raw(`COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date) as gstr_invoice_date`),
            knex.raw(`COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date) as invoice_date`),

            // 3. Amount / Total Mirror
            knex.raw(`COALESCE(NULLIF(gi.document_value, 0), gi.taxable_value + COALESCE(gi.igst,0) + COALESCE(gi.cgst,0) + COALESCE(gi.sgst,0) + COALESCE(gi.cess,0)) as portal_value`),
            knex.raw(`COALESCE(NULLIF(gi.document_value, 0), gi.taxable_value + COALESCE(gi.igst,0) + COALESCE(gi.cgst,0) + COALESCE(gi.sgst,0) + COALESCE(gi.cess,0)) as gstr_invoice_total`),
            knex.raw(`COALESCE(NULLIF(gi.document_value, 0), gi.taxable_value + COALESCE(gi.igst,0) + COALESCE(gi.cgst,0) + COALESCE(gi.sgst,0) + COALESCE(gi.cess,0)) as gstr2b_invoice_total`),

            // 4. Taxable Mirror
            'gi.taxable_value as gstr_taxable',
            'gi.taxable_value as taxable_value',
            'gi.taxable_value as gstr2b_taxable',

            is2aVs2b ? 'gi.return_period as return_period' : knex.raw('COALESCE(tp.period_code, gi.return_period) as return_period'),

            // Purchase/Books specific
            is2aVs2b ? 'sa.document_number_clean as purchase_invoice_number' : 'pi.supplier_invoice_no as purchase_invoice_number',
            is2aVs2b ? 'sa.document_date as purchase_invoice_date' : knex.raw('COALESCE(pi.supplier_invoice_date, pi.book_vchr_date) as purchase_invoice_date'),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.document_value' : (is2a ? 'ps.net_amount' : 'pi.net_amount')}, 0) as purchase_invoice_total`),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')}, 0) as purchase_taxable`),
            knex.raw(is2aVs2b ? `COALESCE(sa.total_tax, COALESCE(sa.igst,0)+COALESCE(sa.cgst,0)+COALESCE(sa.sgst,0)+COALESCE(sa.cess,0)) as purchase_tax` :
                `(COALESCE(${is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount'}, 0) + 
                  COALESCE(${is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount'}, 0) + 
                  COALESCE(${is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount'}, 0) + 
                  COALESCE(${is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount'}, 0)) as purchase_tax`),

            // Portal (GSTR-2B) specific
            knex.raw(`COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) as gstr_tax`),
            knex.raw(`COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) as gstr2b_tax`),
            knex.raw('CASE WHEN gi.taxable_value > 0 THEN ROUND(((COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) / gi.taxable_value) * 100) ELSE 0 END as gstr_tax_rate'),
            'gi.igst as gstr_igst',
            'gi.cgst as gstr_cgst',
            'gi.sgst as gstr_sgst',
            'gi.cess as gstr_cess',
            'gi.itc_available as gstr_itc_available',
            'gi.itc_eligibility as gstr_itc_eligibility',
            'gi.source_section as gstr_source_section',
            'gi.filing_period as gstr_filing_period',
            'gi.filing_date as gstr_filing_date',
            'gi.reverse_charge as gstr_reverse_charge',
            'gi.place_of_supply as gstr_pos',

            // Dynamic GST & Tax Type Mappings
            'gi.source_section as gstr_source_section',
            is2aVs2b ? 'sa.source_section as gst_type' : knex.raw('COALESCE(pi.source_section, gi.source_section) as gst_type'),
            is2aVs2b ? knex.raw('NULL as purchase_voucher_type') : 'pi.voucher_type as purchase_voucher_type',
            'gi.igst as gstr_igst',
            'gi.cgst as gstr_cgst',
            'gi.sgst as gstr_sgst',
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.igst' : (is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount')}, 0) as purchase_igst`),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount')}, 0) as purchase_cgst`),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount')}, 0) as purchase_sgst`),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount')}, 0) as purchase_cess`),
            
            // Book Data: voucher number, voucher date, gst category, tax rate
            is2aVs2b ? knex.raw('NULL as voucher_no') : 'pi.book_vchr_no as voucher_no',
            is2aVs2b ? knex.raw('NULL as voucher_date') : 'pi.book_vchr_date as voucher_date',
            is2aVs2b ? 'sa.source_section as gst_cat' : knex.raw('COALESCE(pi.gstr_category, pi.source_section, gi.source_section) as gst_cat'),
            knex.raw(`
                CASE 
                    WHEN ${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')} > 0 
                    THEN ROUND(((COALESCE(${is2aVs2b ? 'sa.igst' : (is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount')}, 0) + 
                          COALESCE(${is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount')}, 0) + 
                          COALESCE(${is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount')}, 0) + 
                          COALESCE(${is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount')}, 0)) / 
                          ${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')}) * 100)
                    ELSE 0 
                END as purchase_tax_rate
            `),

            // Workflow status from the separate table, defaulting to 'pending'
            knex.raw('COALESCE(rs_pi.recon_status, rs_gi.recon_status, \'pending\') as reconciliation_status'),

            // Differences for UI parity
            knex.raw(`COALESCE(gi.taxable_value, 0) - COALESCE(${is2aVs2b ? 'sa.taxable_value' : (is2a ? 'ps.taxable_total' : 'pi.taxable_total')}, 0) as diff_taxable`),
            knex.raw(`(COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0))) - 
                       (COALESCE(${is2aVs2b ? 'sa.total_tax' :
                    (is2a ? '(COALESCE(ps.total_igst_amount, 0) + COALESCE(ps.total_cgst_amount, 0) + COALESCE(ps.total_sgst_amount, 0) + COALESCE(ps.total_cess_amount, 0))' :
                        '(COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0))')}, 0)) as diff_tax`),
            knex.raw('rr.variance_amount as tax_diff'),

            // --- BULLETPROOF FORCED ALIGNMENT (Moves mirrors to end of query to prevent shadowing) ---
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.isd_document_number, gi.boe_number) as portal_inv_no`),
            knex.raw(`COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date) as portal_inv_date`),

            // Reforce Party Info keys at the end
            knex.raw(`COALESCE(NULLIF(${is2aVs2b ? 'sa.document_number_clean' : 'pi.supplier_invoice_no'}, ''), NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.boe_number) as supplier_invoice_no`),
            knex.raw(`COALESCE(${is2aVs2b ? 'sa.document_date' : 'pi.supplier_invoice_date'}, gi.document_date, gi.isd_document_date, gi.boe_date) as supplier_invoice_date`),
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), gi.document_number_raw, 'MISSING_IN_DB') as v3_check_no`),
            // --- HAMMER FORCE KEYS (Absolute Dedicated Identification) ---
            knex.raw(`COALESCE(NULLIF(gi.document_number_clean, ''), NULLIF(gi.document_number_raw, ''), gi.isd_document_number, gi.boe_number) as hammer_force_no`),
            knex.raw(`COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date) as hammer_force_date`)
        );

        // Map frontend sort keys to DB columns if necessary
        const sortMapping = {
            // Party info
            'gstin': is2aVs2b ? knex.raw('COALESCE(sa.supplier_gstin, gi.supplier_gstin)') : 'supplier_gstin',
            'name': is2aVs2b ? knex.raw('COALESCE(sa.supplier_name, gi.supplier_name)') : 'supplier_name',
            'supplier_name': is2aVs2b ? knex.raw('COALESCE(sa.supplier_name, gi.supplier_name)') : 'supplier_name',
            'gst_type': is2aVs2b ? 'sa.source_section' : knex.raw('COALESCE(pi.source_section, gi.source_section)'),
            'invoice_no': is2aVs2b ? 'sa.document_number_clean' : 'purchase_invoice_number',
            'invoice_date': is2aVs2b ? knex.raw('COALESCE(sa.document_date, gi.document_date)') : knex.raw('COALESCE(pi.supplier_invoice_date, gi.document_date)'),
            'date': is2aVs2b ? knex.raw('COALESCE(sa.document_date, gi.document_date)') : knex.raw('COALESCE(pi.supplier_invoice_date, gi.document_date)'),

            // Portal (Source B) - 2B / 2A / 2Avs2B Portal Data
            'gstr_invoice_date': knex.raw('COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date)'),
            'gstr_invoice_total': knex.raw('COALESCE(gi.document_value, gi.taxable_value, (COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0)))'),
            'gstr2b_invoice_total': knex.raw('COALESCE(gi.document_value, gi.taxable_value, (COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0)))'),
            'gstr_taxable': 'gi.taxable_value',
            'gstr2b_taxable': 'gi.taxable_value',
            'gstr_tax_rate': 'gi.tax_rate',
            'gstr2a_tax_rate': 'gi.tax_rate',
            'gstr2b_tax': knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))'),
            'gstr_tax': knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))'),
            'gstr2a_tax': knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))'),
            'gstr2b_tax_total': knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))'),
            'gstr2a_tax_total': knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))'),
            'gstr_igst': 'gi.igst',
            'gstr_cgst': 'gi.cgst',
            'gstr_sgst': 'gi.sgst',
            'gstr_cess': 'gi.cess',
            'gstr2b_igst': 'gi.igst',
            'gstr2b_cgst': 'gi.cgst',
            'gstr2b_sgst': 'gi.sgst',
            'gstr2b_cess': 'gi.cess',

            // Books / Source A
            'purchase_invoice_total': is2aVs2b ? 'sa.document_value' : 'purchase_invoice_total',
            'purchase_taxable': is2aVs2b ? 'sa.taxable_value' : 'purchase_taxable',
            'purchase_tax_rate': is2aVs2b ? 'sa.tax_rate' : 'pi.tax_rate',
            'purchase_tax': is2aVs2b ? knex.raw('COALESCE(sa.total_tax, COALESCE(sa.igst,0)+COALESCE(sa.cgst,0)+COALESCE(sa.sgst,0)+COALESCE(sa.cess,0))') : 'purchase_tax',
            'purchase_igst': is2aVs2b ? 'sa.igst' : (is2a ? 'ps.total_igst_amount' : 'pi.total_igst_amount'),
            'purchase_cgst': is2aVs2b ? 'sa.cgst' : (is2a ? 'ps.total_cgst_amount' : 'pi.total_cgst_amount'),
            'purchase_sgst': is2aVs2b ? 'sa.sgst' : (is2a ? 'ps.total_sgst_amount' : 'pi.total_sgst_amount'),
            'purchase_cess': is2aVs2b ? 'sa.cess' : (is2a ? 'ps.total_cess_amount' : 'pi.total_cess_amount'),
            'voucher_no': is2aVs2b ? 'sa.document_number_clean' : 'pi.book_vchr_no',
            'voucher_date': is2aVs2b ? 'sa.document_date' : 'pi.book_vchr_date',
            'gst_cat': is2aVs2b ? 'sa.source_section' : knex.raw('COALESCE(pi.gstr_category, pi.source_section, gi.source_section)'),

            // Status
            'difference': 'rr.variance_amount',
            'tax_diff': 'rr.variance_amount',
            'match_analysis': 'rr.match_status',
            'action_status': 'reconciliation_status',
            'created_at': 'rr.created_at'
        };

        // Safe whitelist fallback — if sort_by is not in mapping and not a known safe alias, default to rr.created_at
        const safeAliases = new Set(['supplier_name', 'supplier_gstin', 'supplier_invoice_no', 'supplier_invoice_date',
            'gstr2b_invoice_total', 'gstr2b_taxable', 'gstr2b_tax', 'gstr2b_tax_rate',
            'purchase_invoice_total', 'purchase_taxable', 'purchase_tax', 'purchase_tax_rate',
            'return_period', 'gst_type', 'reconciliation_status', 'rr.created_at', 'rr.match_status', 'rr.variance_amount'
        ]);

        let orderByCol = sortMapping[sort_by];
        if (!orderByCol) {
            orderByCol = safeAliases.has(sort_by) ? sort_by : 'rr.created_at';
        }

        query.orderBy(orderByCol, sort_order || 'desc');

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
            summary,
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
     * Determines if two document categories are compatible for reconciliation.
     * We allow all categories to be cross-matched to handle different terminology 
     * between buyer and supplier (e.g. Buyer's Debit Note = Supplier's Credit Note).
     */
    static areCategoriesCompatible(pCat, gCat) {
        if (!pCat || !gCat) return false;

        // As per user request "dont do hardcode" and "clear all possible outcomes",
        // we allow matching between all documented financial types.
        const validTypes = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'IMPORT', 'ISD'];

        // If both are recognized financial categories, they are "compatible" 
        // and we let the Invoice Number + Amount + GSTIN define the actual match.
        return validTypes.includes(pCat) && validTypes.includes(gCat);
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
        const quarter = month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4;
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

        const periodId = newPeriod.id;

        // 3. Ensure siblings for the quarter exist for UI consistency
        try {
            const fyStartYear = parseInt(fyCode.split('-')[0]);
            let monthsInfo = [];
            if (quarter === 1) monthsInfo = [4, 5, 6].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 2) monthsInfo = [7, 8, 9].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 3) monthsInfo = [10, 11, 12].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 4) monthsInfo = [1, 2, 3].map(m => ({ m, y: fyStartYear + 1 }));

            for (const { m, y } of monthsInfo) {
                const code = `${m.toString().padStart(2, '0')}${y}`;
                if (code === returnPeriod) continue;

                const exists = await db('tax_periods').where({ period_code: code }).first();
                if (!exists) {
                    const mStr = m.toString().padStart(2, '0');
                    const sDate = `${y}-${mStr}-01`;
                    const dObj = new Date(y, m, 0);
                    const eDate = `${y}-${mStr}-${dObj.getDate().toString().padStart(2, '0')}`;
                    const dName = new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

                    await db('tax_periods').insert({
                        fy_id: fyId,
                        month: m,
                        year: y,
                        period_code: code,
                        display_name: dName,
                        start_date: sDate,
                        end_date: eDate,
                        period_type: 'MONTHLY',
                        quarter: quarter
                    });
                }
            }
        } catch (err) {
            console.error('[ReconciliationModel] Error ensuring quarterly siblings:', err.message);
        }

        return periodId;
    }
    /**
     * Get tax summary grouped by period → GST category for the tree-view modal
     */
    static async getRunTaxSummary(workspaceId, runId, filters = {}) {
        const { fy, quarter, month } = filters;

        let run;
        if (runId === 'all') {
            run = { run_type: 'PURCHASE_2B' };
        } else {
            run = await this.getRunById(workspaceId, runId);
        }
        if (!run) return null;

        const is2a = run.run_type === 'PURCHASE_2A';
        const is2aVs2b = run.run_type === 'PURCHASE_2A_VS_2B';
        const gstrTable = (is2a || is2aVs2b) ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices';
        const gstrIdCol = (is2a || is2aVs2b) ? 'gstr2a_invoice_id' : 'gstr2b_invoice_id';

        // ── Period-grouped aggregation ───────────────────────────────────────────
        let aggQuery = knex('reconciliation_results as rr')
            .leftJoin(`${gstrTable} as gi`, `rr.${gstrIdCol}`, 'gi.id');

        if (is2a) {
            const purchaseSummary = knex('purchase_items')
                .select('purchase_id')
                .sum('taxable_amount as taxable_total')
                .sum('igst_amount as total_igst_amount')
                .sum('cgst_amount as total_cgst_amount')
                .sum('sgst_amount as total_sgst_amount')
                .sum('cess_amount as total_cess_amount')
                .groupBy('purchase_id')
                .as('ps');

            aggQuery = aggQuery
                .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
                .leftJoin(purchaseSummary, 'pi.id', 'ps.purchase_id');
        } else if (is2aVs2b) {
            // Source A is GSTR-2A, Source B is GSTR-2B
            aggQuery = knex('reconciliation_results as rr')
                .leftJoin('normalized_gstr2a_invoices as g2a', 'rr.gstr2a_source_id', 'g2a.id')
                .leftJoin('normalized_gstr2b_invoices as g2b', 'rr.gstr2b_invoice_id', 'g2b.id');
        } else {
            aggQuery = aggQuery
                .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id');
        }

        const agg = await aggQuery
            .leftJoin('tax_periods as tp', 'pi.tax_period_id', 'tp.id')
            .where('rr.workspace_id', workspaceId)
            .modify(q => {
                if (runId && runId !== 'all') {
                    q.where('rr.recon_run_id', runId);
                } else {
                    q.join('reconciliation_runs as run_isolation', 'rr.recon_run_id', 'run_isolation.id')
                        .where('run_isolation.run_type', 'PURCHASE_2B');
                }

                let filterYear = null;
                if (fy && fy !== 'ALL') {
                    filterYear = parseInt(fy.split('-')[0]);
                    const months = [];
                    for (let m = 4; m <= 12; m++) months.push(`${String(m).padStart(2, '0')}${filterYear}`);
                    for (let m = 1; m <= 3; m++)  months.push(`${String(m).padStart(2, '0')}${filterYear + 1}`);
                    q.whereIn(knex.raw("COALESCE(tp.period_code, gi.return_period)"), months);
                }
                if (quarter && quarter !== 'ALL') {
                    const qtMap = { '1': [4, 5, 6], '2': [7, 8, 9], '3': [10, 11, 12], '4': [1, 2, 3] };
                    const qtMonths = qtMap[String(quarter)] || [];
                    if (filterYear) {
                        const qPeriods = qtMonths.map(m => `${String(m).padStart(2, '0')}${m >= 4 ? filterYear : filterYear + 1}`);
                        q.whereIn(knex.raw("COALESCE(tp.period_code, gi.return_period)"), qPeriods);
                    }
                }
                if (month && month !== 'ALL') {
                    const m = parseInt(month);
                    if (filterYear) {
                        const yearForMonth = (m >= 1 && m <= 3) ? filterYear + 1 : filterYear;
                        const exactPeriod = `${String(m).padStart(2, '0')}${yearForMonth}`;
                        q.where(function () {
                            this.where('tp.period_code', exactPeriod)
                                .orWhere('gi.return_period', exactPeriod);
                        });
                    } else {
                        const paddedMonth = String(m).padStart(2, '0');
                        q.where(function () {
                            this.where('tp.period_code', 'LIKE', `${paddedMonth}%`)
                                .orWhere('gi.return_period', 'LIKE', `${paddedMonth}%`);
                        });
                    }
                }
            })
            .select(
                knex.raw("COALESCE(tp.period_code, gi.return_period, '000000') as period"),
                knex.raw("UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) as category"),
                // Books side
                knex.raw("COUNT(pi.id) as books_count"),
                knex.raw("SUM(COALESCE(pi.total_igst_amount,0)) as books_igst"),
                knex.raw("SUM(COALESCE(pi.total_cgst_amount,0)) as books_cgst"),
                knex.raw("SUM(COALESCE(pi.total_sgst_amount,0)) as books_sgst"),
                knex.raw("SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0)) as books_tax"),
                // GSTR-2B side
                knex.raw("COUNT(gi.id) as gstr2b_count"),
                knex.raw("SUM(COALESCE(gi.igst,0)) as gstr2b_igst"),
                knex.raw("SUM(COALESCE(gi.cgst,0)) as gstr2b_cgst"),
                knex.raw("SUM(COALESCE(gi.sgst,0)) as gstr2b_sgst"),
                knex.raw("SUM(COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0)) as gstr2b_tax"),
                // Difference
                knex.raw("COUNT(pi.id) - COUNT(gi.id) as diff_count"),
                knex.raw("(SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0))) - (SUM(COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))) as diff_tax"),
                knex.raw("SUM(COALESCE(pi.total_igst_amount,0)) - SUM(COALESCE(gi.igst,0)) as diff_igst"),
                knex.raw("SUM(COALESCE(pi.total_cgst_amount,0)) - SUM(COALESCE(gi.cgst,0)) as diff_cgst"),
                knex.raw("SUM(COALESCE(pi.total_sgst_amount,0)) - SUM(COALESCE(gi.sgst,0)) as diff_sgst")
            )
            .groupByRaw("COALESCE(tp.period_code, gi.return_period, '000000'), UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'))")
            .orderByRaw("COALESCE(tp.period_code, gi.return_period, '000000'), UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'))");

        // ── Invoice-level rows ───────────────────────────────────────────────────
        const invoices = await knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin(`${gstrTable} as gi`, function () {
                this.on('rr.gstr2b_invoice_id', '=', 'gi.id')
                    .orOn('rr.gstr2a_invoice_id', '=', 'gi.id');
            })
            .leftJoin('tax_periods as tp', 'pi.tax_period_id', 'tp.id')
            .where('rr.workspace_id', workspaceId)
            .modify(q => {
                if (runId && runId !== 'all') {
                    q.where('rr.recon_run_id', runId);
                }
            })
            .modify(q => {
                let filterYear = null;
                if (fy && fy !== 'ALL') {
                    filterYear = parseInt(fy.split('-')[0]);
                    const months = [];
                    for (let m = 4; m <= 12; m++) months.push(`${String(m).padStart(2, '0')}${filterYear}`);
                    for (let m = 1; m <= 3; m++)  months.push(`${String(m).padStart(2, '0')}${filterYear + 1}`);
                    q.whereIn(knex.raw("COALESCE(tp.period_code, gi.return_period)"), months);
                }
                if (quarter && quarter !== 'ALL') {
                    const qtMap = { '1': [4, 5, 6], '2': [7, 8, 9], '3': [10, 11, 12], '4': [1, 2, 3] };
                    const qtMonths = qtMap[String(quarter)] || [];
                    if (filterYear) {
                        const qPeriods = qtMonths.map(m => `${String(m).padStart(2, '0')}${m >= 4 ? filterYear : filterYear + 1}`);
                        q.whereIn(knex.raw("COALESCE(tp.period_code, gi.return_period)"), qPeriods);
                    }
                }
                if (month && month !== 'ALL') {
                    const m = parseInt(month);
                    if (filterYear) {
                        const yearForMonth = (m >= 1 && m <= 3) ? filterYear + 1 : filterYear;
                        const exactPeriod = `${String(m).padStart(2, '0')}${yearForMonth}`;
                        q.where(function () {
                            this.where('tp.period_code', exactPeriod)
                                .orWhere('gi.return_period', exactPeriod);
                        });
                    } else {
                        const paddedMonth = String(m).padStart(2, '0');
                        q.where(function () {
                            this.where('tp.period_code', 'LIKE', `${paddedMonth}%`)
                                .orWhere('gi.return_period', 'LIKE', `${paddedMonth}%`);
                        });
                    }
                }
            })
            .select(
                knex.raw("COALESCE(tp.period_code, gi.return_period, '000000') as period"),
                knex.raw("UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) as category"),
                'rr.id as result_id',
                'rr.match_status',
                knex.raw("COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name"),
                knex.raw("COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin"),
                knex.raw("COALESCE(pi.supplier_invoice_no, gi.document_number_clean) as invoice_no"),
                knex.raw("COALESCE(pi.supplier_invoice_date, gi.document_date) as invoice_date"),
                // Books
                knex.raw("COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0) as books_tax"),
                'pi.total_igst_amount as books_igst',
                'pi.total_cgst_amount as books_cgst',
                'pi.total_sgst_amount as books_sgst',
                // GSTR-2B
                knex.raw("COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0) as gstr2b_tax"),
                'gi.igst as gstr2b_igst',
                'gi.cgst as gstr2b_cgst',
                'gi.sgst as gstr2b_sgst',
                'pi.book_vchr_no as vchr_no',
                'pi.gstr_category'
            )
            .orderByRaw("COALESCE(tp.period_code, gi.return_period, '000000'), UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'))");

        // ── Build hierarchy ──────────────────────────────────────────────────────
        const periodMap = {};

        agg.forEach(row => {
            const p = row.period;
            if (!periodMap[p]) {
                periodMap[p] = {
                    period: p,
                    categories: {},
                    books: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0 },
                    gstr2b: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0 },
                };
            }
            const cat = row.category;
            periodMap[p].categories[cat] = {
                category: cat,
                invoices: [],
                books: { count: +row.books_count, tax: +row.books_tax, igst: +row.books_igst, cgst: +row.books_cgst, sgst: +row.books_sgst },
                gstr2b: { count: +row.gstr2b_count, tax: +row.gstr2b_tax, igst: +row.gstr2b_igst, cgst: +row.gstr2b_cgst, sgst: +row.gstr2b_sgst },
            };
            // Accumulate period totals
            periodMap[p].books.count += +row.books_count;
            periodMap[p].books.tax += +row.books_tax;
            periodMap[p].books.igst += +row.books_igst;
            periodMap[p].books.cgst += +row.books_cgst;
            periodMap[p].books.sgst += +row.books_sgst;
            periodMap[p].gstr2b.count += +row.gstr2b_count;
            periodMap[p].gstr2b.tax += +row.gstr2b_tax;
            periodMap[p].gstr2b.igst += +row.gstr2b_igst;
            periodMap[p].gstr2b.cgst += +row.gstr2b_cgst;
            periodMap[p].gstr2b.sgst += +row.gstr2b_sgst;
        });

        invoices.forEach(inv => {
            const p = inv.period;
            const c = inv.category;
            if (periodMap[p]?.categories[c]) {
                periodMap[p].categories[c].invoices.push(inv);
            }
        });

        // Compute grand totals
        const grand = { books: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0 }, gstr2b: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0 } };
        Object.values(periodMap).forEach(p => {
            ['books', 'gstr2b'].forEach(side => {
                ['count', 'tax', 'igst', 'cgst', 'sgst'].forEach(k => { grand[side][k] += p[side][k]; });
            });
        });

        const periods = Object.values(periodMap)
            .sort((a, b) => a.period.localeCompare(b.period))
            .map(p => ({
                ...p,
                categories: Object.values(p.categories).sort((a, b) => a.category.localeCompare(b.category))
            }));

        return { periods, grand };
    }
}

module.exports = ReconciliationModel;
