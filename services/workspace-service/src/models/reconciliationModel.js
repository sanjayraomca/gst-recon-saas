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

            // 2. Fetch purchase vouchers for this workspace/period
            await progressEmitter.emitProgress(runId, 15, 'Fetching purchase invoices...');
            let purchaseQuery = trx('purchase_vouchers')
                .select('purchase_vouchers.*')
                .where({ 'purchase_vouchers.workspace_id': workspaceId });

            // Filter by invoice date if we have the period details
            if (taxPeriod) {
                const isQuarterly = workspace?.filing_type === 'q';
                if (isQuarterly && taxPeriod.quarter) {
                    // Fetch for the entire fiscal quarter
                    // Q1: 4,5,6 | Q2: 7,8,9 | Q3: 10,11,12 | Q4: 1,2,3
                    let quarterMonths = [];
                    if (taxPeriod.quarter === 1) quarterMonths = [4, 5, 6];
                    else if (taxPeriod.quarter === 2) quarterMonths = [7, 8, 9];
                    else if (taxPeriod.quarter === 3) quarterMonths = [10, 11, 12];
                    else if (taxPeriod.quarter === 4) quarterMonths = [1, 2, 3];

                    purchaseQuery = purchaseQuery
                        .whereIn(trx.raw('EXTRACT(MONTH FROM purchase_vouchers.supplier_invoice_date)'), quarterMonths)
                        .whereRaw('EXTRACT(YEAR FROM purchase_vouchers.supplier_invoice_date) = ?', [taxPeriod.year]);
                } else {
                    purchaseQuery = purchaseQuery
                        .whereRaw('EXTRACT(MONTH FROM purchase_vouchers.supplier_invoice_date) = ?', [taxPeriod.month])
                        .whereRaw('EXTRACT(YEAR FROM purchase_vouchers.supplier_invoice_date) = ?', [taxPeriod.year]);
                }
            }

            const purchaseInvoices = await purchaseQuery;
            console.log(`[MatchingTask] Fetched ${purchaseInvoices.length} purchase vouchers for period:`, taxPeriod);

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
                const isQuarterly = workspace?.filing_type === 'q';
                if (isQuarterly && taxPeriod.quarter) {
                    let quarterMonths = [];
                    if (taxPeriod.quarter === 1) quarterMonths = [4, 5, 6];
                    else if (taxPeriod.quarter === 2) quarterMonths = [7, 8, 9];
                    else if (taxPeriod.quarter === 3) quarterMonths = [10, 11, 12];
                    else if (taxPeriod.quarter === 4) quarterMonths = [1, 2, 3];

                    gstrQuery = gstrQuery
                        .whereIn(trx.raw('EXTRACT(MONTH FROM normalized_gstr2b_invoices.document_date)'), quarterMonths)
                        .whereRaw('EXTRACT(YEAR FROM normalized_gstr2b_invoices.document_date) = ?', [taxPeriod.year]);
                } else {
                    gstrQuery = gstrQuery
                        .whereRaw('EXTRACT(MONTH FROM normalized_gstr2b_invoices.document_date) = ?', [taxPeriod.month])
                        .whereRaw('EXTRACT(YEAR FROM normalized_gstr2b_invoices.document_date) = ?', [taxPeriod.year]);
                }
            }

            const gstr2bInvoices = await gstrQuery;
            console.log(`[MatchingTask] Fetched ${gstr2bInvoices.length} ${portalTypeLabel} invoices`);


            // 4. Perform matching
            await progressEmitter.emitProgress(runId, 45, 'Performing rule-based matching...');
            const matchResults = [];
            const matchedGstr2bIds = new Set();
            const unmatchedPurchases = [];
            let matchedCount = 0;
            let mismatchedCount = 0;
            let missingCount = 0;

            // Step 0: Include all invoices for matching (bypassing strict GSTIN filter for IMPG)
            const validPurchaseInvoices = purchaseInvoices;
            const validGstr2bInvoices = gstr2bInvoices;

            // Helper to map Books categories to Portal categories
            const mapCategory = (booksType) => {
                const type = (booksType || 'PURCHASE').toUpperCase();
                if (type === 'CREDIT_NOTE') return 'CREDIT_NOTE';
                if (type === 'DEBIT_NOTE') return 'DEBIT_NOTE';
                return 'INVOICE'; // PURCHASE, EXPENSE -> INVOICE
            };

            // STEP 1: MATCH BY INVOICE NUMBER (STRICT)
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

                    const gCategory = gstr2bInv.document_category || 'INVOICE';

                    // 1. GSTIN Match (Bypass for IMPORT)
                    const pGstin = this.normalizeGstin(purchaseInv.supplier_gstin);
                    const gGstin = this.normalizeGstin(gstr2bInv.supplier_gstin);
                    const gstinMatch = (pGstin && gGstin && pGstin === gGstin);

                    if (!gstinMatch && gCategory !== 'IMPORT') return false;

                    // 2. Category Match (Invoice vs Note vs Import vs ISD)
                    if (pCategory !== gCategory) {
                        if (!(pCategory === 'INVOICE' && ['IMPORT', 'ISD'].includes(gCategory))) {
                            return false;
                        }
                    }

                    // 3. Invoice Number Match (Including Amendment check)
                    const gNormalizedInv = this.normalizeInvoiceNumber(gstr2bInv.document_number_clean);
                    const gOriginalInv = this.normalizeInvoiceNumber(gstr2bInv.original_invoice_number);
                    const invMatch = (pNormalizedInv === gNormalizedInv) || (gOriginalInv && pNormalizedInv === gOriginalInv);

                    if (!invMatch) return false;

                    const gNet = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    const gTaxable = isNaN(parseFloat(gstr2bInv.taxable_value)) ? 0 : parseFloat(gstr2bInv.taxable_value);
                    const gTax = (parseFloat(gstr2bInv.igst) || 0) +
                        (parseFloat(gstr2bInv.cgst) || 0) +
                        (parseFloat(gstr2bInv.sgst) || 0) +
                        (parseFloat(gstr2bInv.cess) || 0);
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
                    const diffDays = (pDate - gDate) / (1000 * 60 * 60 * 24);
                    const diffTaxable = pTaxable - gTaxable;
                    const diffTax = pTax - gTax;

                    const dateNear = diffDays >= -VAR_DAYS_MAX && diffDays <= VAR_DAYS_MIN;
                    const taxableNear = diffTaxable >= -(VAR_TAXABLE_MAX + 0.01) && diffTaxable <= (VAR_TAXABLE_MIN + 0.01);
                    const taxNear = diffTax >= -(VAR_TAX_MAX + 0.01) && diffTax <= (VAR_TAX_MIN + 0.01);

                    if (dateNear && taxableNear && taxNear) {
                        matchType = (exactDate && exactTaxable && exactTax) ? 'MATCHED' : 'MISMATCH';
                        return true;
                    }

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
                        match_status: finalStatus, // Holds the logic result (matched, mismatch, etc.)
                        match_score: finalStatus === 'matched' ? 100.00 : (finalStatus === 'not_eligible' ? 0 : 70.00),
                        match_confidence: finalStatus === 'matched' ? 'HIGH' : 'MEDIUM',
                        books_value: pNet,
                        portal_value: match.document_value || 0,
                        variance_amount: pNet - (match.document_value || 0),
                        itc_decision: isEligible ? (finalStatus === 'matched' ? 'ELIGIBLE' : 'PENDING') : 'INELIGIBLE',
                        decision_reason: !isEligible ? 'ITC Not Available in GSTR2B' : (finalStatus === 'matched' ? 'Exact match found' : 'Partial match / variance detected'),
                        action_required: !isEligible ? 'REVIEW_ELIGIBILITY' : (finalStatus === 'mismatch' ? 'REVIEW_AMOUNT' : null),
                        action_status: 'pending', // Initially pending
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });

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
                const match = validGstr2bInvoices.find(gstr2bInv => {
                    if (matchedGstr2bIds.has(gstr2bInv.id)) return false;

                    const gCategory = gstr2bInv.document_category || 'INVOICE';

                    // 1. GSTIN Match (Bypass for IMPORT)
                    const pGstin = this.normalizeGstin(purchaseInv.supplier_gstin);
                    const gGstin = this.normalizeGstin(gstr2bInv.supplier_gstin);
                    const gstinMatch = (pGstin && gGstin && pGstin === gGstin);

                    if (!gstinMatch && gCategory !== 'IMPORT') return false;

                    // 2. Category Match
                    if (pCategory !== gCategory) {
                        if (!(pCategory === 'INVOICE' && ['IMPORT', 'ISD'].includes(gCategory))) {
                            return false;
                        }
                    }

                    // 3. Amount + Date Match (Fuzzy)
                    const gNet = isNaN(parseFloat(gstr2bInv.document_value)) ? 0 : parseFloat(gstr2bInv.document_value);
                    const gTaxable = isNaN(parseFloat(gstr2bInv.taxable_value)) ? 0 : parseFloat(gstr2bInv.taxable_value);
                    const gTax = (parseFloat(gstr2bInv.igst) || 0) +
                        (parseFloat(gstr2bInv.cgst) || 0) +
                        (parseFloat(gstr2bInv.sgst) || 0) +
                        (parseFloat(gstr2bInv.cess) || 0);
                    const gDate = new Date(gstr2bInv.document_date);

                    const dateDiff = Math.abs((pDate - gDate) / (1000 * 60 * 60 * 24));
                    const diffTaxable = Math.abs(pTaxable - gTaxable);
                    const diffTax = Math.abs(pTax - gTax);

                    // Thresholds for fuzzy matching
                    const dateNear = dateDiff <= 30; // Within 30 days
                    const taxableMatch = diffTaxable < (VAR_TAXABLE_MAX + 1);
                    const taxMatch = diffTax < (VAR_TAX_MAX + 1);

                    if (dateNear && taxableMatch && taxMatch) {
                        matchType = (dateDiff === 0 && diffTaxable < 0.01) ? 'MATCHED' : 'MISMATCH';
                        return true;
                    }

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
                        match_score: finalStatus === 'matched' ? 90.00 : 60.00,
                        match_confidence: 'LOW',
                        matched_by: 'FUZZY',
                        books_value: pNet,
                        portal_value: match.document_value || 0,
                        variance_amount: pNet - (match.document_value || 0),
                        itc_decision: isEligible ? 'PENDING' : 'INELIGIBLE',
                        decision_reason: `Fuzzy Match: Matched by amount and date (+/- 30 days)`,
                        action_required: 'REVIEW_MATCH',
                        action_status: 'pending',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });
                } else {
                    remainingPurchases.push(purchaseInv);
                }
            }

            // 4c. Process unmatched purchases
            for (const purchaseInv of remainingPurchases) {
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
                    action_status: 'pending',
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
                        action_status: 'pending',
                        created_at: knex.fn.now(),
                        updated_at: knex.fn.now()
                    });
                    missingCount++;
                }
            }

            if (matchResults.length > 0) {
                await progressEmitter.emitProgress(runId, 85, 'Saving reconciliation results...');

                // collection of invoice IDs to clear previous results
                const purchaseIds = matchResults.map(r => r.purchase_invoice_id).filter(id => id);
                const gstr2bIds = matchResults.map(r => r.gstr2b_invoice_id).filter(id => id);

                // --- 1. Prevent Duplicates: Delete existing results for these invoices in this workspace ---
                if (purchaseIds.length > 0 || gstr2bIds.length > 0) {
                    const deleteQuery = trx('reconciliation_results')
                        .where('workspace_id', workspaceId)
                        .where(function () {
                            if (purchaseIds.length > 0) this.whereIn('purchase_invoice_id', purchaseIds);
                            if (gstr2bIds.length > 0) this.orWhereIn('gstr2b_invoice_id', gstr2bIds);
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
                    .filter(r => r.purchase_invoice_id || r.gstr2b_invoice_id)
                    .map(r => ({
                        workspace_id: workspaceId,
                        tenant_id: tenantId,
                        book_data_id: r.purchase_invoice_id || null,
                        book_data_type: r.purchase_invoice_id ? 'purchase_voucher' : null,
                        gstr_data_id: r.gstr2b_invoice_id || null,
                        gstr_type: r.gstr2b_invoice_id ? 'gstr2b' : null,
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
                    total_invoices: purchaseInvoices.length + gstr2bInvoices.length,
                    matched_count: matchedCount,
                    mismatched_count: mismatchedCount,
                    missing_count: missingCount,
                    completed_at: knex.fn.now(),
                    result_summary: JSON.stringify({
                        purchase_vouchers: purchaseInvoices.length,
                        normalized_gstr2b_invoices: gstr2bInvoices.length,
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
            workflow_status,
            page = 1,
            page_size = 50,
            export_mode,
            period,
            fy,
            quarter,
            month
        } = filters;

        // Verify run belongs to workspace
        const run = await this.getRunById(workspaceId, runId);
        if (!run) return null;

        let query = knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            // Join with tax_periods using purchase_vouchers fk or normalized_gstr2b_invoices period_code
            .leftJoin('tax_periods as tp', function () {
                this.on('tp.id', '=', 'pi.tax_period_id')
                    .orOn(function () {
                        this.on('tp.period_code', '=', 'gi.return_period')
                            .andOnNull('pi.tax_period_id');
                    });
            })
            // Join with financial_years to support fy_code filtering
            .leftJoin('financial_years as fymas', 'tp.fy_id', 'fymas.id')
            // Join with reconciliation_status table to get the workflow status
            .leftJoin('reconciliation_status as rs_pi', 'rr.purchase_invoice_id', 'rs_pi.book_data_id')
            .leftJoin('reconciliation_status as rs_gi', 'rr.gstr2b_invoice_id', 'rs_gi.gstr_data_id');

        // Apply Run ID filter ONLY if status is not 'pending'
        // If status is 'pending', we show all historical pending data for the workspace
        if (workflow_status === 'pending') {
            query.where('rr.workspace_id', workspaceId);
        } else {
            query.where('rr.recon_run_id', runId);
        }

        // Hide records where GSTIN is missing (as per user request "else hide the data")
        query.where(function () {
            this.whereNotNull('pi.supplier_gstin')
                .orWhereNotNull('gi.supplier_gstin');
        }).andWhere(function () {
            this.where('pi.supplier_gstin', '!=', '')
                .orWhere('gi.supplier_gstin', '!=', '');
        });

        // --- Apply Filters ---
        if (match_status && match_status !== 'all' && match_status !== 'ALL') {
            query.where('rr.match_status', match_status);
        }

        if (workflow_status && workflow_status !== 'all' && workflow_status !== 'ALL') {
            if (workflow_status === 'pending') {
                // For pending, we show rows where status is either explicitly 'pending' or NULL
                query.where(function () {
                    this.where(knex.raw('COALESCE(rs_pi.recon_status, rs_gi.recon_status, \'pending\')'), 'pending');
                });
            } else {
                query.where(function () {
                    this.where('rs_pi.recon_status', workflow_status)
                        .orWhere('rs_gi.recon_status', workflow_status);
                });
            }
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
                this.where('pi.supplier_invoice_date', '>=', date_from)
                    .orWhere('gi.document_date', '>=', date_from);
            });
        }

        if (date_to) {
            query.where(function () {
                this.where('pi.supplier_invoice_date', '<=', date_to)
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

        // Bypass specific period filters if we are looking at all pending historical data
        // UNLESS a month/fy filter is explicitly selected to act as an end-date (per user request)
        const isPendingView = workflow_status === 'pending';

        // --- NEW: Cumulative Period Filtering (Month as End Date) ---
        let dateLimit = null;
        if ((fy && fy !== 'ALL') || (month && month !== 'ALL') || (quarter && quarter !== 'ALL')) {
            const periodQuery = knex('tax_periods as tp')
                .join('financial_years as fymas2', 'tp.fy_id', 'fymas2.id')
                .select('tp.end_date')
                .orderBy('tp.end_date', 'desc');

            if (fy && fy !== 'ALL') {
                if (fy.includes('-')) {
                    periodQuery.where('fymas2.fy_code', fy);
                } else {
                    periodQuery.where('tp.year', parseInt(fy));
                }
            }

            if (quarter && quarter !== 'ALL') {
                periodQuery.where('tp.quarter', parseInt(quarter));
            }

            if (month && month !== 'ALL') {
                periodQuery.where('tp.month', parseInt(month));
            }

            const latestPeriod = await periodQuery.first();
            if (latestPeriod) {
                dateLimit = latestPeriod.end_date;
            }
        }

        if (dateLimit) {
            query.where('tp.end_date', '<=', dateLimit);
            // Also strictly limit invoice dates to ensure no data from future periods appears
            query.where(function () {
                this.where('pi.supplier_invoice_date', '<=', dateLimit)
                    .orWhere('gi.document_date', '<=', dateLimit);
            });
        } else if (period && period !== 'ALL' && !isPendingView) {
            // Fallback to exact period if dateLimit wasn't calculated (legacy behavior)
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
        const totalsQuery = query.clone()
            .clearSelect()
            .select(
                knex.raw('SUM(gi.taxable_value) as gstr2b_taxable_total'),
                knex.raw('SUM(pi.taxable_total) as purchase_taxable_total'),
                knex.raw('SUM(COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0))) as gstr2b_tax_total'),
                knex.raw('SUM(COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0)) as purchase_tax_total'),
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
                purchase_tax: parseFloat(totalsResult.purchase_tax_total || 0)
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
            'rr.books_value',
            'rr.portal_value',
            'rr.variance_amount',
            'rr.created_at',
            'rr.updated_at',

            // Row identification
            'pi.id as purchase_invoice_id',
            'gi.id as gstr2b_invoice_id',

            // Supplier mapping
            knex.raw('COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name'),
            knex.raw('COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin'),
            knex.raw('COALESCE(tp.period_code, gi.return_period) as return_period'), // Explicit period code

            // Purchase/Books mapping
            'pi.supplier_invoice_no as purchase_invoice_number',
            knex.raw('COALESCE(pi.supplier_invoice_date, pi.book_vchr_date) as purchase_invoice_date'),
            'pi.net_amount as purchase_invoice_total',
            'pi.taxable_total as purchase_taxable',
            knex.raw('COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0) as purchase_tax'),
            knex.raw('CASE WHEN pi.taxable_total > 0 THEN ROUND(((COALESCE(pi.total_igst_amount, 0) + COALESCE(pi.total_cgst_amount, 0) + COALESCE(pi.total_sgst_amount, 0) + COALESCE(pi.total_cess_amount, 0)) / pi.taxable_total) * 100) ELSE 0 END as purchase_tax_rate'),
            'pi.is_rcm as purchase_is_rcm',
            'pi.total_cess_amount as purchase_cess',
            'pi.is_interstate as purchase_is_interstate',
            'pi.book_vchr_no',
            'pi.book_vchr_date',
            'pi.book_type',
            'pi.filing_period as purchase_filing_period',
            'pi.filing_date as purchase_filing_date',
            'pi.itc_eligible as purchase_itc_eligible',
            'pi.place_of_supply as purchase_pos',

            // GSTR-2B mapping
            'gi.document_number_clean as gstr2b_invoice_number',
            'gi.document_date as gstr2b_invoice_date',
            'gi.document_value as gstr2b_invoice_total',
            'gi.taxable_value as gstr2b_taxable',
            knex.raw('COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) as gstr2b_tax'),
            knex.raw('CASE WHEN gi.taxable_value > 0 THEN ROUND(((COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) / gi.taxable_value) * 100) ELSE 0 END as gstr2b_tax_rate'),
            'gi.applicable_tax_rate_percent as gstr2b_tax_rate_percent',
            'gi.itc_available as gstr2b_itc_available',
            'gi.itc_eligibility as gstr2b_itc_eligibility',
            'gi.itc_reason as gstr2b_itc_reason',
            'gi.cess as gstr2b_cess',
            'gi.original_invoice_number as gstr2b_original_invoice_number',
            'gi.original_invoice_date as gstr2b_original_invoice_date',
            'gi.filing_period as gstr2b_filing_period',
            'gi.filing_date as gstr2b_filing_date',
            'gi.reverse_charge as gstr2b_reverse_charge',
            'gi.place_of_supply as gstr2b_pos',

            // Dynamic GST & Tax Type Mappings
            'gi.source_section as gstr2b_source_section',
            'pi.voucher_type as purchase_voucher_type',
            'gi.igst as gstr2b_igst',
            'gi.cgst as gstr2b_cgst',
            'gi.sgst as gstr2b_sgst',
            'pi.total_igst_amount as purchase_igst',
            'pi.total_cgst_amount as purchase_cgst',
            'pi.total_sgst_amount as purchase_sgst',

            // Workflow status from the separate table, defaulting to 'pending'
            knex.raw('COALESCE(rs_pi.recon_status, rs_gi.recon_status, \'pending\') as reconciliation_status')
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

        return newPeriod.id;
    }
}

module.exports = ReconciliationModel;
