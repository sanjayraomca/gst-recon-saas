const knex = require('../../../shared/src/db/connection');
const progressEmitter = require('../utils/progressEmitter');

/**
 * Reconciliation 2A Model
 * Handles invoice matching between purchase invoices and GSTR-2A invoices
 */
class Reconciliation2AModel {
    /**
     * Create a reconciliation run
     */
    static async createRun(workspaceId, runData) {
        const trx = await knex.transaction();
        try {
            const { gstin_id, period, period_id, run_type = 'PURCHASE_2A', run_mode = 'MANUAL' } = runData;
            let taxPeriodId = period_id;

            if (!taxPeriodId && period && period !== 'ALL') {
                taxPeriodId = await this.ensureTaxPeriodExists(period, trx);
            }

            const [reconRun] = await trx('reconciliation_runs')
                .insert({
                    id: knex.raw('uuid_generate_v4()'),
                    workspace_id: workspaceId,
                    gstin_id: gstin_id,
                    period_id: taxPeriodId,
                    run_type: run_type,
                    run_mode: run_mode,
                    rule_set_version: '1.0.0',
                    rule_set_hash: '2a_basic_v1',
                    status: 'RUNNING',
                    started_at: knex.fn.now(),
                    created_at: knex.fn.now()
                })
                .returning('*');

            await trx.commit();
            const runId = reconRun.id;

            // Trigger the matching task in the background
            this.runMatchingTask(workspaceId, runId, taxPeriodId, runData).catch(err => {
                console.error(`[2A Recon Error] Background task failed for run ${runId}:`, err);
            });

            return runId;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }

    /**
     * Background task to perform GSTR-2A vs Books reconciliation
     */
    static async runMatchingTask(workspaceId, runId, taxPeriodId, runData) {
        let trx;
        try {
            await progressEmitter.emitProgress(runId, 5, 'Starting GSTR-2A reconciliation...');
            trx = await knex.transaction();

            const run_type = runData?.run_type || 'PURCHASE_2A';
            const is2aVs2b = run_type === 'GSTR2A_VS_GSTR2B';

            let taxPeriod = null;
            if (taxPeriodId) {
                taxPeriod = await trx('tax_periods').where({ id: taxPeriodId }).first();
            }

            const workspace = await trx('workspaces').where({ id: workspaceId }).first();
            const wsSettings = typeof workspace?.settings === 'string' ? JSON.parse(workspace.settings) : (workspace?.settings || {});

            const VAR_DAYS_MIN = parseFloat(wsSettings.variance_days_min) || 30;
            const VAR_DAYS_MAX = parseFloat(wsSettings.variance_days_max) || 30;
            const VAR_TAXABLE_MIN = parseFloat(wsSettings.variance_taxable_min) || 1;
            const VAR_TAXABLE_MAX = parseFloat(wsSettings.variance_taxable_max) || 1;
            const VAR_TAX_MIN = parseFloat(wsSettings.variance_tax_min) || 1;
            const VAR_TAX_MAX = parseFloat(wsSettings.variance_tax_max) || 1;

            // 1. Fetch Source A (Books or 2A)
            await progressEmitter.emitProgress(runId, 15, is2aVs2b ? 'Fetching GSTR-2A invoices...' : 'Fetching purchase invoices...');
            let sourceAInvoices = [];

            if (is2aVs2b) {
                sourceAInvoices = await trx('normalized_gstr2a_invoices')
                    .where({ workspace_id: workspaceId })
                    .where('source_table', 'like', 'gstr_2a%')
                    .modify(q => {
                        if (taxPeriod) {
                            q.whereRaw(`EXTRACT(MONTH FROM document_date) = ?`, [taxPeriod.month])
                                .whereRaw(`EXTRACT(YEAR FROM document_date) = ?`, [taxPeriod.year]);
                        }
                    });
            } else {
                // Aggregate from purchase_vouchers for 2A vs Books
                sourceAInvoices = await trx('purchase_vouchers')
                    .select(
                        'id',
                        'supplier_invoice_no',
                        'supplier_invoice_date',
                        'supplier_gstin',
                        'voucher_type',
                        'taxable_total',
                        'total_igst_amount',
                        'total_cgst_amount',
                        'total_sgst_amount',
                        'total_cess_amount',
                        'net_amount'
                    )
                    .where({ 'workspace_id': workspaceId })
                    .whereNotNull('supplier_gstin')
                    .where('supplier_gstin', '!=', '')
                    .whereNotNull('supplier_invoice_no')
                    .modify(q => {
                        if (taxPeriod) {
                            q.whereRaw(`EXTRACT(MONTH FROM supplier_invoice_date) = ?`, [taxPeriod.month])
                                .whereRaw(`EXTRACT(YEAR FROM supplier_invoice_date) = ?`, [taxPeriod.year]);
                        }
                    });
            }

            // 2. Fetch Source B (GSTR-2A or GSTR-2B)
            const gstrTable = is2aVs2b ? 'normalized_gstr2b_invoices' : 'normalized_gstr2a_invoices';
            const sourceBPrefix = is2aVs2b ? 'gstr_2b%' : 'gstr_2a%';

            await progressEmitter.emitProgress(runId, 30, `Fetching ${is2aVs2b ? 'GSTR-2B' : 'GSTR-2A'}...`);
            const sourceBInvoices = await trx(gstrTable)
                .where({ workspace_id: workspaceId })
                .where('source_table', 'like', sourceBPrefix)
                .whereNot('document_number_raw', 'like', '%-Total')
                .modify(q => {
                    if (taxPeriod) {
                        q.whereRaw(`EXTRACT(MONTH FROM document_date) = ?`, [taxPeriod.month])
                            .whereRaw(`EXTRACT(YEAR FROM document_date) = ?`, [taxPeriod.year]);
                    }
                });

            // 3. Matching Logic (Simplified call to common logic or implementation here)
            // For now, let's include the core matching loop
            const matchResults = [];
            const matchedBIds = new Set();
            const unmatchedA = [];

            const mapCategory = (booksType) => {
                const type = (booksType || '').toString().toUpperCase();
                if (type.includes('CREDIT')) return 'CREDIT_NOTE';
                if (type.includes('DEBIT')) return 'DEBIT_NOTE';
                if (type.includes('IMPORT') || type.includes('BOE')) return 'IMPORT';
                if (type.includes('ISD')) return 'ISD';
                return 'INVOICE';
            };

            const createMatchResult = (overrides) => ({
                recon_run_id: runId,
                workspace_id: workspaceId,
                match_status: 'unmatched',
                match_score: 0.00,
                match_confidence: 'LOW',
                matched_by: 'RULE',
                books_value: 0,
                portal_value: 0,
                variance_amount: 0,
                itc_decision: 'PENDING',
                action_priority: 'MEDIUM',
                action_status: 'pending',
                created_at: knex.fn.now(),
                updated_at: knex.fn.now(),
                ...overrides
            });

            const matchedCount = { matched: 0, mismatch: 0, partial: 0 };

            // --- Step 1: Strict Match (Invoice No + GSTIN + Category + Tolerance) ---
            for (const invA of sourceAInvoices) {
                const rawInvNo = is2aVs2b ? invA.document_number_clean : invA.supplier_invoice_no;
                const pNormalizedInv = Reconciliation2AModel.normalizeInvoiceNumber(rawInvNo);
                const pGstin = invA.supplier_gstin;
                const pDateObj = new Date(is2aVs2b ? invA.document_date : invA.supplier_invoice_date);
                const pCategory = mapCategory(is2aVs2b ? 'INVOICE' : invA.voucher_type); // 2A source is always portal-like

                const taxA = is2aVs2b ? (parseFloat(invA.total_tax) || 0) :
                    ((parseFloat(invA.total_igst_amount) || 0) + (parseFloat(invA.total_cgst_amount) || 0) +
                        (parseFloat(invA.total_sgst_amount) || 0) + (parseFloat(invA.total_cess_amount) || 0));

                const match = sourceBInvoices.find(b => {
                    if (matchedBIds.has(b.id)) return false;

                    // 1. GSTIN Match
                    if (b.supplier_gstin !== pGstin) return false;

                    // 2. Category Match
                    const bCategory = mapCategory('INVOICE'); // Source B is always GSTR (2A or 2B)
                    if (!Reconciliation2AModel.areCategoriesCompatible(pCategory, bCategory)) return false;

                    // 3. Invoice Number Match
                    const bNormalizedInv = Reconciliation2AModel.normalizeInvoiceNumber(b.document_number_clean || b.document_number_raw);
                    if (pNormalizedInv !== bNormalizedInv) return false;

                    // 4. Date and Amount check (Tolerance)
                    const bDate = new Date(b.document_date);
                    const bTax = parseFloat(b.total_tax) || 0;

                    const dateDiff = Math.abs((pDateObj - bDate) / (1000 * 60 * 60 * 24));
                    const taxDiff = Math.abs(taxA - bTax);

                    return dateDiff <= VAR_DAYS_MAX && taxDiff <= (VAR_TAX_MAX + 0.01);
                });

                if (match) {
                    matchedBIds.add(match.id);
                    const taxB = parseFloat(match.total_tax) || 0;
                    const taxDiff = Math.abs(taxA - taxB);
                    const isExact = taxDiff < 0.01;

                    matchResults.push(createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : invA.id,
                        gstr2a_source_id: is2aVs2b ? invA.id : null,
                        gstr2a_invoice_id: is2aVs2b ? null : match.id,
                        gstr2b_invoice_id: is2aVs2b ? match.id : null,
                        match_status: isExact ? 'matched' : 'partial_match',
                        match_score: isExact ? 100.00 : 90.00,
                        match_confidence: 'HIGH',
                        books_value: taxA,
                        portal_value: taxB,
                        variance_amount: taxA - taxB,
                        decision_reason: isExact ? 'Exact Match found' : `Matched within tolerance: tax diff ±${taxDiff.toFixed(2)}`
                    }));
                } else {
                    unmatchedA.push(invA);
                }
            }

            // --- Step 2: Amount Fallback Match (Same GSTIN + same amount + same month) ---
            const finalUnmatchedA = [];
            for (const invA of unmatchedA) {
                const pGstin = invA.supplier_gstin;
                const pDateObj = new Date(is2aVs2b ? invA.document_date : invA.supplier_invoice_date);
                const taxA = is2aVs2b ? (parseFloat(invA.total_tax) || 0) :
                    ((parseFloat(invA.total_igst_amount) || 0) + (parseFloat(invA.total_cgst_amount) || 0) +
                        (parseFloat(invA.total_sgst_amount) || 0) + (parseFloat(invA.total_cess_amount) || 0));

                const match = sourceBInvoices.find(b => {
                    if (matchedBIds.has(b.id)) return false;
                    if (b.supplier_gstin !== pGstin) return false;

                    const bTax = parseFloat(b.total_tax) || 0;
                    if (Math.abs(taxA - bTax) > 0.01) return false;

                    const bDate = new Date(b.document_date);
                    return pDateObj.getMonth() === bDate.getMonth() && pDateObj.getFullYear() === bDate.getFullYear();
                });

                if (match) {
                    matchedBIds.add(match.id);
                    matchResults.push(createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : invA.id,
                        gstr2a_source_id: is2aVs2b ? invA.id : null,
                        gstr2a_invoice_id: is2aVs2b ? null : match.id,
                        gstr2b_invoice_id: is2aVs2b ? match.id : null,
                        match_status: 'matched',
                        match_score: 85.00,
                        match_confidence: 'MEDIUM',
                        books_value: taxA,
                        portal_value: taxA,
                        variance_amount: 0,
                        decision_reason: 'Match by Amount/Date (Invoice No mismatch)'
                    }));
                } else {
                    finalUnmatchedA.push(invA);
                }
            }

            // --- Step 3: Finalize Unmatched ---
            for (const invA of finalUnmatchedA) {
                const taxA = is2aVs2b ? (parseFloat(invA.total_tax) || 0) :
                    ((parseFloat(invA.total_igst_amount) || 0) + (parseFloat(invA.total_cgst_amount) || 0) +
                        (parseFloat(invA.total_sgst_amount) || 0) + (parseFloat(invA.total_cess_amount) || 0));

                matchResults.push(createMatchResult({
                    purchase_invoice_id: is2aVs2b ? null : invA.id,
                    gstr2a_source_id: is2aVs2b ? invA.id : null,
                    match_status: 'missing_in_portal',
                    books_value: taxA,
                    variance_amount: taxA,
                    decision_reason: `Not found in ${is2aVs2b ? 'GSTR-2B' : 'GSTR-2A'}`
                }));
            }

            for (const invB of sourceBInvoices) {
                if (matchedBIds.has(invB.id)) continue;
                const taxB = parseFloat(invB.total_tax) || 0;

                matchResults.push(createMatchResult({
                    gstr2a_invoice_id: is2aVs2b ? null : invB.id,
                    gstr2b_invoice_id: is2aVs2b ? invB.id : null,
                    match_status: 'missing_in_books',
                    portal_value: taxB,
                    variance_amount: -taxB,
                    decision_reason: 'Not found in records'
                }));
            }

            // 4. Save Results
            if (matchResults.length > 0) {
                await progressEmitter.emitProgress(runId, 85, 'Saving results...');

                // Clear existing for these IDs
                const pIds = matchResults.map(r => r.purchase_invoice_id).filter(Boolean);
                const g2aIds = matchResults.map(r => r.gstr2a_invoice_id).filter(Boolean);
                const g2asIds = matchResults.map(r => r.gstr2a_source_id).filter(Boolean);

                if (pIds.length || g2aIds.length || g2asIds.length) {
                    await trx('reconciliation_results').where('workspace_id', workspaceId).where(function () {
                        if (pIds.length) this.orWhereIn('purchase_invoice_id', pIds);
                        if (g2aIds.length) this.orWhereIn('gstr2a_invoice_id', g2aIds);
                        if (g2asIds.length) this.orWhereIn('gstr2a_source_id', g2asIds);
                    })
                        .whereIn('recon_run_id', function () {
                            this.select('id').from('reconciliation_runs')
                                .whereIn('run_type', ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B']);
                        })
                        .delete();
                }

                const inserted = await trx('reconciliation_results').insert(matchResults).returning('*');

                // Update 2A specific status table
                await progressEmitter.emitProgress(runId, 95, 'Updating status tracking...');
                const tenantId = workspace?.tenant_id || workspaceId;
                const statusRows = inserted.map(r => ({
                    workspace_id: workspaceId,
                    tenant_id: tenantId,
                    gstr_data_id: r.gstr2a_invoice_id || null,
                    book_data_id: r.purchase_invoice_id || null,
                    recon_status: r.match_status === 'matched' ? 'matched' : (r.match_status === 'missing_in_portal' ? 'not_in_portal' : 'not_in_books'),
                }));

                // 1. Deduplicate summary status (Key by Book ID or GSTR ID)
                const dedupedStatus = new Map();
                for (const row of statusRows) {
                    const key = row.book_data_id || row.gstr_data_id;
                    if (!key) continue;
                    dedupedStatus.set(key, row);
                }

                for (const row of dedupedStatus.values()) {
                    // Check by BOTH IDs to prevent unique constraint violations
                    const existing = await trx('reconciliation_status_gst2a_vs_book')
                        .where('workspace_id', workspaceId)
                        .where(function () {
                            if (row.book_data_id) this.orWhere('book_data_id', row.book_data_id);
                            if (row.gstr_data_id) this.orWhere('gstr_data_id', row.gstr_data_id);
                        })
                        .first();

                    if (existing) {
                        await trx('reconciliation_status_gst2a_vs_book')
                            .where({ id: existing.id })
                            .update({
                                gstr_data_id: row.gstr_data_id || existing.gstr_data_id,
                                book_data_id: row.book_data_id || existing.book_data_id,
                                recon_status: row.recon_status,
                                updated_date: knex.fn.now()
                            });
                    } else {
                        await trx('reconciliation_status_gst2a_vs_book').insert({
                            ...row,
                            added_date: knex.fn.now(),
                            updated_date: knex.fn.now()
                        });
                    }
                }
            }

            await trx('reconciliation_runs').where({ id: runId }).update({
                status: 'COMPLETED',
                completed_at: knex.fn.now()
            });

            await trx.commit();
            await progressEmitter.emitProgress(runId, 100, 'Completed');

        } catch (error) {
            if (trx) await trx.rollback();
            console.error(`[2A Recon Task] Run ${runId} failed:`, error);
            await progressEmitter.emitProgress(runId, 0, `Failed: ${error.message}`, true);
        }
    }

    /**
     * Get 2A Results
     */
    static async getRunResults(workspaceId, runId, filters = {}) {
        const {
            page = 1, page_size = 50,
            match_status, workflow_status, search,
            sort_by = 'created_at', sort_order = 'desc',
            supplier_gstin, date_from, date_to,
            min_amount, max_amount, has_variance,
            fy, quarter, month, place_of_supply,
            column_filters: column_filters_raw,
        } = filters;

        console.log(`[Reconciliation2AModel] getRunResults → sort_by: ${sort_by}, sort_order: ${sort_order}, runId: ${runId}`);

        // Parse column_filters from JSON string (sent by frontend via URLSearchParams)
        let parsedColumnFilters = {};
        if (column_filters_raw) {
            try {
                parsedColumnFilters = typeof column_filters_raw === 'string'
                    ? JSON.parse(column_filters_raw)
                    : column_filters_raw;
            } catch (e) {
                parsedColumnFilters = {};
            }
        }

        const query = knex('reconciliation_results as rr')
            .leftJoin('reconciliation_runs as run', 'rr.recon_run_id', 'run.id')
            .leftJoin('normalized_gstr2a_invoices as gi', 'rr.gstr2a_invoice_id', 'gi.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2a_invoices as sa', 'rr.gstr2a_source_id', 'sa.id')
            .leftJoin('normalized_gstr2b_invoices as gb', 'rr.gstr2b_invoice_id', 'gb.id')
            .leftJoin('reconciliation_status_gst2a_vs_book as rs', function () {
                this.on('rr.workspace_id', '=', 'rs.workspace_id')
                    .andOn(function () {
                        this.on('rr.purchase_invoice_id', '=', 'rs.book_data_id')
                            .orOn('rr.gstr2a_invoice_id', '=', 'rs.gstr_data_id')
                            .orOn('rr.gstr2a_source_id', '=', 'rs.book_data_id');
                    });
            })
            .where('rr.workspace_id', workspaceId);

        if (runId !== 'all') {
            query.where('rr.recon_run_id', runId);
        } else {
            query.whereIn('run.run_type', ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B']);
        }

        // ── Standard Filters ─────────────────────────────────────────────────
        if (match_status && match_status !== 'all') {
            const statusList = Array.isArray(match_status) ? match_status : match_status.split(',').map(s => s.trim());
            query.whereIn('rr.match_status', statusList);
        }

        if (workflow_status && workflow_status !== 'all' && workflow_status !== 'pending') {
            const statusList = Array.isArray(workflow_status) ? workflow_status : workflow_status.split(',').map(s => s.trim());
            query.whereIn(knex.raw("COALESCE(rs.recon_status, 'pending')"), statusList);
        }

        if (search) {
            query.where(function () {
                this.where('pi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('gi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('sa.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_invoice_no', 'ilike', `%${search}%`)
                    .orWhere('gi.document_number_raw', 'ilike', `%${search}%`)
                    .orWhere('sa.document_number_raw', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_gstin', 'ilike', `%${search}%`)
                    .orWhere('gi.supplier_gstin', 'ilike', `%${search}%`)
                    .orWhere('sa.supplier_gstin', 'ilike', `%${search}%`);
            });
        }

        if (supplier_gstin) {
            const gstins = (Array.isArray(supplier_gstin) ? supplier_gstin : supplier_gstin.split(',')).map(s => s.trim()).filter(Boolean);
            if (gstins.length > 0) {
                query.where(function () {
                    this.whereIn('pi.supplier_gstin', gstins)
                        .orWhereIn('gi.supplier_gstin', gstins)
                        .orWhereIn('sa.supplier_gstin', gstins);
                });
            }
        }

        if (date_from) {
            query.where(function () {
                this.where('pi.supplier_invoice_date', '>=', date_from)
                    .orWhere('gi.document_date', '>=', date_from)
                    .orWhere('sa.document_date', '>=', date_from);
            });
        }

        if (date_to) {
            query.where(function () {
                this.where('pi.supplier_invoice_date', '<=', date_to)
                    .orWhere('gi.document_date', '<=', date_to)
                    .orWhere('sa.document_date', '<=', date_to);
            });
        }

        const isValidNumeric = (v) => v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v)) && isFinite(v);

        if (isValidNumeric(min_amount)) {
            const min = parseFloat(min_amount);
            query.where(function () {
                this.where('pi.net_amount', '>=', min)
                    .orWhere('gi.document_value', '>=', min)
                    .orWhere(knex.raw('COALESCE(sa.taxable_value, 0) + COALESCE(sa.total_tax, 0) >= ?', [min]));
            });
        }

        if (isValidNumeric(max_amount)) {
            const max = parseFloat(max_amount);
            query.where(function () {
                this.where('pi.net_amount', '<=', max)
                    .orWhere('gi.document_value', '<=', max)
                    .orWhere(knex.raw('COALESCE(sa.taxable_value, 0) + COALESCE(sa.total_tax, 0) <= ?', [max]));
            });
        }

        if (place_of_supply) {
            const posList = (Array.isArray(place_of_supply) ? place_of_supply : place_of_supply.split(',')).map(s => s.trim()).filter(Boolean);
            if (posList.length > 0) {
                query.where(function () {
                    this.whereIn('pi.place_of_supply', posList)
                        .orWhereIn('gi.place_of_supply', posList)
                        .orWhereIn('sa.place_of_supply', posList);
                });
            }
        }

        if (has_variance === 'true') {
            query.where('rr.variance_amount', '!=', 0);
        }

        // Period filter
        if (fy && fy !== 'ALL') {
            const fyYear = parseInt(fy.split('-')[0]);
            if (!isNaN(fyYear)) {
                query.where(function () {
                    this.whereRaw(
                        `(EXTRACT(YEAR FROM pi.supplier_invoice_date) = ? AND EXTRACT(MONTH FROM pi.supplier_invoice_date) >= 4)
                        OR (EXTRACT(YEAR FROM pi.supplier_invoice_date) = ? AND EXTRACT(MONTH FROM pi.supplier_invoice_date) <= 3)
                        OR (EXTRACT(YEAR FROM gi.document_date) = ? AND EXTRACT(MONTH FROM gi.document_date) >= 4)
                        OR (EXTRACT(YEAR FROM gi.document_date) = ? AND EXTRACT(MONTH FROM gi.document_date) <= 3)`,
                        [fyYear, fyYear + 1, fyYear, fyYear + 1]
                    );
                });
            }
        }

        if (month && month !== 'ALL') {
            const m = parseInt(month);
            query.where(function () {
                this.whereRaw('EXTRACT(MONTH FROM pi.supplier_invoice_date) = ?', [m])
                    .orWhereRaw('EXTRACT(MONTH FROM gi.document_date) = ?', [m])
                    .orWhereRaw('EXTRACT(MONTH FROM sa.document_date) = ?', [m]);
            });
        }

        if (quarter && quarter !== 'ALL') {
            const q = parseInt(quarter);
            const months = q === 1 ? [4, 5, 6] : (q === 2 ? [7, 8, 9] : (q === 3 ? [10, 11, 12] : [1, 2, 3]));
            query.where(function () {
                this.whereIn(knex.raw('EXTRACT(MONTH FROM pi.supplier_invoice_date)'), months)
                    .orWhereIn(knex.raw('EXTRACT(MONTH FROM gi.document_date)'), months)
                    .orWhereIn(knex.raw('EXTRACT(MONTH FROM sa.document_date)'), months);
            });
        }

        // ── Column Inline Filters (colMapping) ───────────────────────────────
        // Maps frontend columnFilters keys → SQL column expressions
        const colMapping = {
            // Identity
            gstin: { cols: ['pi.supplier_gstin', 'gi.supplier_gstin', 'sa.supplier_gstin', 'gb.supplier_gstin'] },
            name: { cols: ['pi.supplier_name', 'sa.supplier_name', 'gi.supplier_name', 'gb.supplier_name'] },
            gst_type: { cols: ['pi.source_section', 'gi.source_section', 'gb.source_section'] },
            invoice_no: { cols: ['pi.supplier_invoice_no', 'gi.document_number_clean', 'sa.document_number_raw', 'gb.document_number_raw'] },
            invoice_date: { cols: ['pi.supplier_invoice_date', 'gi.document_date', 'sa.document_date', 'gb.document_date'], dateCol: true },
            voucher_no: { cols: ['pi.book_vchr_no'] },
            gst_cat: { cols: ['pi.gstr_category', 'pi.source_section', 'sa.source_section', 'gi.source_section', 'gb.source_section'] },
            voucher_date: { cols: ['pi.book_vchr_date'], dateCol: true },
            // Status
            status: { cols: ['rr.match_status'], exact: true },
            action_status: { cols: [knex.raw("COALESCE(rs.recon_status, 'pending')")], exact: true },
            // GSTR-2A Portal columns
            gstr_invoice_total: { cols: ['gi.document_value'], numeric: true },
            gstr_taxable: { cols: ['gi.taxable_value'], numeric: true },
            gstr_tax_rate: { cols: ['gi.tax_rate'], numeric: true },
            gstr2a_tax_rate: { cols: ['gi.tax_rate'], numeric: true },
            gstr2a_tax_total: { cols: [knex.raw('COALESCE(gi.total_tax, 0)')], numeric: true },
            gstr_tax: { cols: [knex.raw('COALESCE(gi.total_tax, 0)')], numeric: true },
            gstr_igst: { cols: ['gi.igst'], numeric: true },
            gstr_cgst: { cols: ['gi.cgst'], numeric: true },
            gstr_sgst: { cols: ['gi.sgst'], numeric: true },
            gstr_cess: { cols: ['gi.cess'], numeric: true },
            // Books / 2B columns
            book_invoice_total: { cols: [knex.raw('COALESCE(pi.net_amount, sa.total_tax + sa.taxable_value, gb.total_tax + gb.taxable_value)')], numeric: true },
            purchase_taxable: { cols: [knex.raw('COALESCE(pi.taxable_total, sa.taxable_value, gb.taxable_value)')], numeric: true },
            book_taxable: { cols: [knex.raw('COALESCE(pi.taxable_total, sa.taxable_value, gb.taxable_value)')], numeric: true },
            purchase_tax_rate: { cols: ['pi.tax_rate', 'gb.tax_rate'], numeric: true },
            book_tax_rate: { cols: ['pi.tax_rate', 'gb.tax_rate'], numeric: true },
            purchase_tax_total: { cols: [knex.raw('COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(sa.total_tax, 0)+COALESCE(gb.total_tax, 0)')], numeric: true },
            book_tax: { cols: [knex.raw('COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(sa.total_tax, 0)+COALESCE(gb.total_tax, 0)')], numeric: true },
            purchase_igst: { cols: [knex.raw('COALESCE(pi.total_igst_amount, sa.igst, gb.igst, 0)')], numeric: true },
            book_igst: { cols: [knex.raw('COALESCE(pi.total_igst_amount, sa.igst, gb.igst, 0)')], numeric: true },
            purchase_cgst: { cols: [knex.raw('COALESCE(pi.total_cgst_amount, sa.cgst, gb.cgst, 0)')], numeric: true },
            book_cgst: { cols: [knex.raw('COALESCE(pi.total_cgst_amount, sa.cgst, gb.cgst, 0)')], numeric: true },
            purchase_sgst: { cols: [knex.raw('COALESCE(pi.total_sgst_amount, sa.sgst, gb.sgst, 0)')], numeric: true },
            book_sgst: { cols: [knex.raw('COALESCE(pi.total_sgst_amount, sa.sgst, gb.sgst, 0)')], numeric: true },
            purchase_cess: { cols: [knex.raw('COALESCE(pi.total_cess_amount, sa.cess, gb.cess, 0)')], numeric: true },
            book_cess: { cols: [knex.raw('COALESCE(pi.total_cess_amount, sa.cess, gb.cess, 0)')], numeric: true },
            tax_diff: { cols: ['rr.variance_amount'], numeric: true },
            difference: { cols: ['rr.variance_amount'], numeric: true },
            place_of_supply: { cols: ['pi.place_of_supply', 'gi.place_of_supply', 'sa.place_of_supply', 'gb.place_of_supply'] },
        };

        // Apply each column filter
        Object.entries(parsedColumnFilters).forEach(([key, value]) => {
            const isEmpty = !value || (Array.isArray(value) && value.length === 0) || value === '';
            if (isEmpty) return;

            const def = colMapping[key];
            if (!def) return;

            const valueList = Array.isArray(value) ? value.filter(Boolean) : [value];
            if (valueList.length === 0) return;

            if (def.dateCol) {
                // Parse date strings in dd/MM/yyyy or yyyy-MM-dd format
                query.where(function () {
                    const self = this;
                    def.cols.forEach((col, ci) => {
                        valueList.forEach((v, vi) => {
                            let dbDate = v;
                            const parts = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                            if (parts) dbDate = `${parts[3]}-${parts[2]}-${parts[1]}`;
                            const method = (ci === 0 && vi === 0) ? 'whereRaw' : 'orWhereRaw';
                            self[method](`DATE(${typeof col === 'string' ? col : col.toSQL().sql}) = ?`, [dbDate]);
                        });
                    });
                });
            } else if (def.numeric) {
                // Numeric range: each value can be "50" or ">=50" or "<=50"
                query.where(function () {
                    const self = this;
                    def.cols.forEach((col, ci) => {
                        valueList.forEach((v, vi) => {
                            const num = parseFloat(v);
                            if (isNaN(num)) return;
                            const method = (ci === 0 && vi === 0) ? 'whereRaw' : 'orWhereRaw';
                            const colExpr = typeof col === 'string' ? col : col.toSQL().sql;
                            self[method](`CAST(${colExpr} AS DECIMAL) = ?`, [num]);
                        });
                    });
                });
            } else if (def.exact) {
                // Exact match (e.g. match_status, action_status)
                query.where(function () {
                    const self = this;
                    def.cols.forEach((col, ci) => {
                        const method = ci === 0 ? 'whereIn' : 'orWhereIn';
                        if (typeof col === 'string') {
                            self[method](col, valueList);
                        } else {
                            valueList.forEach((v, vi) => {
                                const m = (ci === 0 && vi === 0) ? 'whereRaw' : 'orWhereRaw';
                                self[m](`${col.toSQL().sql} = ?`, [v]);
                            });
                        }
                    });
                });
            } else {
                // Text ILIKE search
                query.where(function () {
                    const self = this;
                    def.cols.forEach((col, ci) => {
                        valueList.forEach((v, vi) => {
                            const method = (ci === 0 && vi === 0) ? 'where' : 'orWhere';
                            if (typeof col === 'string') {
                                self[method](col, 'ilike', `%${v}%`);
                            } else {
                                const m = (ci === 0 && vi === 0) ? 'whereRaw' : 'orWhereRaw';
                                self[m](`${col.toSQL().sql} ILIKE ?`, [`%${v}%`]);
                            }
                        });
                    });
                });
            }
        });

        // Totals
        const totalsResult = await query.clone().clearSelect().select(
            knex.raw('COUNT(*) as total_count'),
            knex.raw("SUM(CASE WHEN rr.match_status IN ('matched', 'tolerance_match') THEN 1 ELSE 0 END) as matched_count"),
            knex.raw("SUM(CASE WHEN rr.match_status IN ('mismatch', 'partial_match') THEN 1 ELSE 0 END) as mismatch_count"),
            knex.raw("SUM(CASE WHEN rr.match_status = 'missing_in_portal' THEN 1 ELSE 0 END) as missing_in_portal_count"),
            knex.raw("SUM(CASE WHEN rr.match_status = 'missing_in_books' THEN 1 ELSE 0 END) as missing_in_books_count"),
            knex.raw('SUM(COALESCE(pi.taxable_total, sa.taxable_value, 0)) as book_taxable_total'),
            knex.raw('SUM(COALESCE(gi.taxable_value, gb.taxable_value, 0)) as gstr_taxable_total'),
            knex.raw('SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.total_tax, 0)) as book_tax_total'),
            knex.raw('SUM(COALESCE(gi.total_tax, gb.total_tax, 0)) as gstr_tax_total'),
            knex.raw('SUM(COALESCE(pi.total_cgst_amount, sa.cgst, 0)) as book_cgst_total'),
            knex.raw('SUM(COALESCE(pi.total_sgst_amount, sa.sgst, 0)) as book_sgst_total'),
            knex.raw('SUM(COALESCE(pi.total_cess_amount, sa.cess, 0)) as book_cess_total'),
            knex.raw('SUM(COALESCE(gi.cgst, gb.cgst, 0)) as gstr_cgst_total'),
            knex.raw('SUM(COALESCE(gi.sgst, gb.sgst, 0)) as gstr_sgst_total'),
            knex.raw('SUM(COALESCE(gi.cess, gb.cess, 0)) as gstr_cess_total')
        ).first();

        const total = parseInt(totalsResult.total_count || 0);

        query.select(
            'rr.*',
            knex.raw('COALESCE(pi.supplier_invoice_no, sa.document_number_raw, gb.document_number_raw) as purchase_invoice_number'),
            knex.raw('COALESCE(pi.supplier_invoice_date, sa.document_date, gb.document_date) as purchase_invoice_date'),
            knex.raw('COALESCE(pi.supplier_name, sa.supplier_name, gb.supplier_name) as purchase_supplier_name'),
            knex.raw('COALESCE(pi.supplier_gstin, sa.supplier_gstin, gb.supplier_gstin) as purchase_gstin'),
            knex.raw('COALESCE(gi.document_number_clean, sa.document_number_clean) as gstr_invoice_number'),
            knex.raw('COALESCE(gi.document_number_raw, sa.document_number_raw) as gstr_invoice_number_raw'),
            knex.raw('COALESCE(gi.document_date, sa.document_date) as gstr_invoice_date'),
            knex.raw('COALESCE(pi.supplier_gstin, sa.supplier_gstin, gi.supplier_gstin, gb.supplier_gstin) as supplier_gstin'),
            knex.raw('COALESCE(pi.supplier_name, sa.supplier_name, gi.supplier_name, gb.supplier_name) as supplier_name'),
            knex.raw('COALESCE(gi.taxable_value, gb.taxable_value) as gstr_taxable'),
            knex.raw('COALESCE(gi.total_tax, gb.total_tax) as gstr_tax'),
            knex.raw('COALESCE(gi.igst, gb.igst) as gstr_igst'),
            knex.raw('COALESCE(gi.cgst, gb.cgst) as gstr_cgst'),
            knex.raw('COALESCE(gi.sgst, gb.sgst) as gstr_sgst'),
            knex.raw('COALESCE(gi.cess, gb.cess) as gstr_cess'),
            knex.raw('COALESCE(pi.taxable_total, sa.taxable_value) as purchase_taxable'),
            knex.raw('(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.total_tax, 0)) as purchase_tax'),
            knex.raw('COALESCE(pi.total_igst_amount, sa.igst) as purchase_igst'),
            knex.raw('COALESCE(pi.total_cgst_amount, sa.cgst) as purchase_cgst'),
            knex.raw('COALESCE(pi.total_sgst_amount, sa.sgst) as purchase_sgst'),
            knex.raw('COALESCE(pi.total_cess_amount, sa.cess) as purchase_cess'),
            knex.raw('COALESCE(pi.net_amount, sa.taxable_value + sa.total_tax) as purchase_invoice_total'),
            knex.raw('pi.book_vchr_no as book_vchr_no'),
            knex.raw('pi.book_vchr_date as book_vchr_date'),
            knex.raw('COALESCE(pi.gstr_category, pi.source_section, sa.source_section, gi.source_section, gb.source_section) as gstr_category'),
            knex.raw('COALESCE(gi.itc_available, sa.itc_available) as gstr2a_itc_available'),
            knex.raw('COALESCE(gi.itc_eligibility, sa.itc_eligibility) as gstr2a_itc_eligibility'),
            knex.raw('COALESCE(gi.itc_reason, sa.itc_reason) as gstr2a_itc_reason'),
            knex.raw('COALESCE(pi.place_of_supply, sa.place_of_supply) as purchase_pos'),
            knex.raw('COALESCE(gi.place_of_supply, sa.place_of_supply) as gstr2a_pos'),
            knex.raw("COALESCE(rs.recon_status, 'pending') as reconciliation_status")
        );

        // Sort mapping — covers every column visible in AdvancedReconciliation2A.jsx
        const sortColumnMap = {
            // Party / Identity
            'gstin': 'supplier_gstin',
            'supplier_gstin': 'supplier_gstin',
            'name': 'supplier_name',
            'supplier_name': 'supplier_name',
            'gst_type': knex.raw('COALESCE(pi.source_section, gi.source_section)'),
            'invoice_no': 'purchase_invoice_number',
            'purchase_invoice_number': 'purchase_invoice_number',
            'invoice_header_no': 'gstr_invoice_number',
            'invoice_date': 'purchase_invoice_date',
            'date': 'purchase_invoice_date',

            // GSTR-2A (Portal) columns
            'gstr_invoice_total': 'gstr_invoice_total',
            'gstr2a_invoice_total': 'gstr_invoice_total',
            'gstr_taxable': 'gstr_taxable',
            'gstr2a_taxable': 'gstr_taxable',
            'gstr2a_tax_rate': 'gstr2a_tax_rate',
            'gstr_tax_rate': 'gstr2a_tax_rate',
            'gstr2a_tax': 'gstr_tax',
            'gstr2a_tax_total': 'gstr_tax',
            'gstr_tax': 'gstr_tax',
            'gstr_igst': 'gstr_igst',
            'gstr_cgst': 'gstr_cgst',
            'gstr_sgst': 'gstr_sgst',
            'gstr_cess': 'gstr_cess',

            // Books columns
            'purchase_invoice_total': 'purchase_invoice_total',
            'purchase_taxable': 'purchase_taxable',
            'purchase_tax_rate': 'purchase_tax_rate',
            'book_tax_rate': 'purchase_tax_rate',
            'purchase_tax': 'purchase_tax',
            'purchase_tax_total': 'purchase_tax',
            'purchase_igst': 'purchase_igst',
            'purchase_cgst': 'purchase_cgst',
            'purchase_sgst': 'purchase_sgst',
            'purchase_cess': 'purchase_cess',
            'voucher_no': 'book_vchr_no',
            'gst_cat': 'gstr_category',
            'voucher_date': 'book_vchr_date',

            // Status
            'difference': 'rr.variance_amount',
            'tax_diff': 'rr.variance_amount',
            'match_analysis': 'rr.match_status',
            'match_status': 'rr.match_status',
            'action_status': 'reconciliation_status',
            'reconciliation_status': 'reconciliation_status',
            'created_at': 'rr.created_at',
        };
        query.orderBy(sortColumnMap[sort_by] || 'rr.created_at', sort_order);

        const limit = parseInt(page_size) || 50;
        const offset = (parseInt(page) - 1) * limit;

        const results = await query.limit(limit).offset(offset);

        return {
            data: results,
            pagination: { total, page: parseInt(page), page_size: limit, total_pages: Math.ceil(total / limit) },
            summary: {
                matched_count: parseInt(totalsResult.matched_count || 0),
                mismatch_count: parseInt(totalsResult.mismatch_count || 0),
                missing_in_portal_count: parseInt(totalsResult.missing_in_portal_count || 0),
                missing_in_books_count: parseInt(totalsResult.missing_in_books_count || 0),
                totals: {
                    purchase_taxable: parseFloat(totalsResult.book_taxable_total || 0),
                    gstr_taxable: parseFloat(totalsResult.gstr_taxable_total || 0),
                    purchase_tax: parseFloat(totalsResult.book_tax_total || 0),
                    gstr_tax: parseFloat(totalsResult.gstr_tax_total || 0),
                    gstr2a_tax: parseFloat(totalsResult.gstr_tax_total || 0),
                    purchase_cgst: parseFloat(totalsResult.book_cgst_total || 0),
                    purchase_sgst: parseFloat(totalsResult.book_sgst_total || 0),
                    purchase_cess: parseFloat(totalsResult.book_cess_total || 0),
                    gstr_cgst: parseFloat(totalsResult.gstr_cgst_total || 0),
                    gstr_sgst: parseFloat(totalsResult.gstr_sgst_total || 0),
                    gstr_cess: parseFloat(totalsResult.gstr_cess_total || 0)
                }
            }
        };
    }

    static async getRunTaxSummary(workspaceId, runId, filters = {}) {
        const { fy, quarter, month } = filters;

        let run;
        if (runId === 'all') {
            run = { run_type: 'PURCHASE_2A' }; // Default to 2A vs Books
        } else {
            run = await knex('reconciliation_runs').where({ id: runId, workspace_id: workspaceId }).first();
        }
        if (!run) return null;

        const baseQuery = knex('reconciliation_results as rr')
            .leftJoin('reconciliation_runs as r', 'rr.recon_run_id', 'r.id')
            .leftJoin('normalized_gstr2a_invoices as gi', 'rr.gstr2a_invoice_id', 'gi.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2a_invoices as sa', 'rr.gstr2a_source_id', 'sa.id')
            .leftJoin('normalized_gstr2b_invoices as gb', 'rr.gstr2b_invoice_id', 'gb.id')
            .leftJoin('tax_periods as tp', 'pi.tax_period_id', 'tp.id')
            .where('rr.workspace_id', workspaceId);

        if (runId !== 'all') {
            baseQuery.where('rr.recon_run_id', runId);
        } else {
            baseQuery.whereIn('r.run_type', ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B']);
        }

        // Apply same period filters as getRunResults
        if (fy && fy !== 'ALL') {
            const fyYear = parseInt(fy.split('-')[0]);
            if (!isNaN(fyYear)) {
                baseQuery.where(function () {
                    this.whereRaw(
                        `(EXTRACT(YEAR FROM pi.supplier_invoice_date) = ? AND EXTRACT(MONTH FROM pi.supplier_invoice_date) >= 4)
                        OR (EXTRACT(YEAR FROM pi.supplier_invoice_date) = ? AND EXTRACT(MONTH FROM pi.supplier_invoice_date) <= 3)
                        OR (EXTRACT(YEAR FROM gi.document_date) = ? AND EXTRACT(MONTH FROM gi.document_date) >= 4)
                        OR (EXTRACT(YEAR FROM gi.document_date) = ? AND EXTRACT(MONTH FROM gi.document_date) <= 3)
                        OR (EXTRACT(YEAR FROM sa.document_date) = ? AND EXTRACT(MONTH FROM sa.document_date) >= 4)
                        OR (EXTRACT(YEAR FROM sa.document_date) = ? AND EXTRACT(MONTH FROM sa.document_date) <= 3)`,
                        [fyYear, fyYear + 1, fyYear, fyYear + 1, fyYear, fyYear + 1]
                    );
                });
            }
        }
        if (month && month !== 'ALL') {
            const m = parseInt(month);
            baseQuery.where(function () {
                this.whereRaw('EXTRACT(MONTH FROM pi.supplier_invoice_date) = ?', [m])
                    .orWhereRaw('EXTRACT(MONTH FROM gi.document_date) = ?', [m])
                    .orWhereRaw('EXTRACT(MONTH FROM sa.document_date) = ?', [m])
                    .orWhereRaw('EXTRACT(MONTH FROM gb.document_date) = ?', [m]);
            });
        }
        if (quarter && quarter !== 'ALL') {
            const q = parseInt(quarter);
            const months = q === 1 ? [4, 5, 6] : (q === 2 ? [7, 8, 9] : (q === 3 ? [10, 11, 12] : [1, 2, 3]));
            baseQuery.where(function () {
                this.whereIn(knex.raw('EXTRACT(MONTH FROM pi.supplier_invoice_date)'), months)
                    .orWhereIn(knex.raw('EXTRACT(MONTH FROM gi.document_date)'), months)
                    .orWhereIn(knex.raw('EXTRACT(MONTH FROM sa.document_date)'), months)
                    .orWhereIn(knex.raw('EXTRACT(MONTH FROM gb.document_date)'), months);
            });
        }

        const [agg, rows] = await Promise.all([
            baseQuery.clone()
                .select(
                    knex.raw("COALESCE(tp.period_code, gi.return_period, sa.return_period, gb.return_period, '000000') as period"),
                    knex.raw("UPPER(COALESCE(pi.source_section, gi.source_section, sa.source_section, gb.source_section, 'OTHER')) as category"),
                    // Books / Source A
                    knex.raw("COUNT(DISTINCT pi.id) + COUNT(DISTINCT sa.id) as books_count"),
                    knex.raw("SUM(COALESCE(pi.total_igst_amount,0) + COALESCE(sa.igst, 0)) as books_igst"),
                    knex.raw("SUM(COALESCE(pi.total_cgst_amount,0) + COALESCE(sa.cgst, 0)) as books_cgst"),
                    knex.raw("SUM(COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.sgst, 0)) as books_sgst"),
                    knex.raw("SUM(COALESCE(pi.total_cess_amount,0) + COALESCE(sa.cess, 0)) as books_cess"),
                    knex.raw("SUM(COALESCE(pi.total_igst_amount,0) + COALESCE(pi.total_cgst_amount,0) + COALESCE(pi.total_sgst_amount,0) + COALESCE(pi.total_cess_amount,0) + COALESCE(sa.total_tax, 0)) as books_tax"),
                    // GSTR / Source B
                    knex.raw("COUNT(DISTINCT COALESCE(gi.id, gb.id)) as gstr_count"),
                    knex.raw("SUM(COALESCE(gi.igst, gb.igst, 0)) as gstr_igst"),
                    knex.raw("SUM(COALESCE(gi.cgst, gb.cgst, 0)) as gstr_cgst"),
                    knex.raw("SUM(COALESCE(gi.sgst, gb.sgst, 0)) as gstr_sgst"),
                    knex.raw("SUM(COALESCE(gi.cess, gb.cess, 0)) as gstr_cess"),
                    knex.raw("SUM(COALESCE(gi.total_tax, gb.total_tax, 0)) as gstr_tax"),
                    // Match Status totals (for summary overview)
                    knex.raw("SUM(CASE WHEN rr.match_status IN ('matched', 'tolerance_match', 'exact_match') THEN COALESCE(gi.total_tax, gb.total_tax, 0) ELSE 0 END) as matched_tax"),
                    knex.raw("SUM(CASE WHEN rr.match_status IN ('partial_match', 'mismatch', 'probability_match') THEN COALESCE(gi.total_tax, gb.total_tax, 0) ELSE 0 END) as partial_tax"),
                    knex.raw("SUM(CASE WHEN rr.match_status IN ('missing_in_books', 'not_in_books') THEN COALESCE(gi.total_tax, gb.total_tax, 0) ELSE 0 END) as mismatch_tax")
                )
                .groupByRaw("COALESCE(tp.period_code, gi.return_period, sa.return_period, gb.return_period, '000000'), UPPER(COALESCE(pi.source_section, gi.source_section, sa.source_section, gb.source_section, 'OTHER'))"),
            baseQuery.clone()
                .select(
                    knex.raw("COALESCE(tp.period_code, gi.return_period, sa.return_period, gb.return_period, '000000') as period"),
                    knex.raw("UPPER(COALESCE(pi.source_section, gi.source_section, sa.source_section, gb.source_section, 'OTHER')) as category"),
                    'rr.id as result_id',
                    'rr.match_status',
                    'pi.book_vchr_no as vchr_no',
                    knex.raw("COALESCE(pi.supplier_name, gi.supplier_name, sa.supplier_name, gb.supplier_name, 'Unknown') as supplier_name"),
                    knex.raw("COALESCE(pi.supplier_gstin, gi.supplier_gstin, sa.supplier_gstin, gb.supplier_gstin) as supplier_gstin"),
                    knex.raw("COALESCE(pi.supplier_invoice_no, gi.document_number_clean, sa.document_number_clean, gb.document_number_clean) as invoice_no"),
                    knex.raw("COALESCE(pi.supplier_invoice_date, gi.document_date, sa.document_date, gb.document_date) as invoice_date"),
                    // Books
                    knex.raw("(COALESCE(pi.total_igst_amount,0) + COALESCE(pi.total_cgst_amount,0) + COALESCE(pi.total_sgst_amount,0) + COALESCE(pi.total_cess_amount,0) + COALESCE(sa.total_tax, 0)) as books_tax"),
                    knex.raw("COALESCE(pi.total_igst_amount, sa.igst, 0) as books_igst"),
                    knex.raw("COALESCE(pi.total_cgst_amount, sa.cgst, 0) as books_cgst"),
                    knex.raw("COALESCE(pi.total_sgst_amount, sa.sgst, 0) as books_sgst"),
                    knex.raw("COALESCE(pi.total_cess_amount, sa.cess, 0) as books_cess"),
                    // GSTR
                    knex.raw("COALESCE(gi.total_tax, gb.total_tax, 0) as gstr_tax"),
                    knex.raw("COALESCE(gi.total_tax, 0) as gstr2a_tax"),
                    knex.raw("COALESCE(gi.igst, gb.igst, 0) as gstr_igst"),
                    knex.raw("COALESCE(gi.cgst, gb.cgst, 0) as gstr_cgst"),
                    knex.raw("COALESCE(gi.sgst, gb.sgst, 0) as gstr_sgst"),
                    knex.raw("COALESCE(gi.cess, gb.cess, 0) as gstr_cess"),
                    knex.raw("COALESCE(gi.igst, 0) as gstr2a_igst"),
                    knex.raw("COALESCE(gi.cgst, 0) as gstr2a_cgst"),
                    knex.raw("COALESCE(gi.sgst, 0) as gstr2a_sgst"),
                    knex.raw("COALESCE(gi.cess, 0) as gstr2a_cess")
                )
                .limit(2000)
        ]);

        // Hierarchy construction
        const periodMap = {};
        const catMap = {};

        agg.forEach(row => {
            const p = row.period;
            if (!periodMap[p]) {
                periodMap[p] = {
                    period: p,
                    categories: [],
                    books: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
                    gstr2a: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
                    // Parity for 2A vs 2B component
                    book_tax: 0, gst_tax: 0, matched_tax: 0, partial_tax: 0, mismatch_tax: 0
                };
            }

            const cat = {
                category: row.category,
                books: { count: +row.books_count, tax: +row.books_tax, igst: +row.books_igst, cgst: +row.books_cgst, sgst: +row.books_sgst, cess: +row.books_cess },
                gstr2a: { count: +row.gstr_count, tax: +row.gstr_tax, igst: +row.gstr_igst, cgst: +row.gstr_cgst, sgst: +row.gstr_sgst, cess: +row.gstr_cess },
                book_tax: +row.books_tax,
                gst_tax: +row.gstr_tax,
                matched_tax: +row.matched_tax,
                partial_tax: +row.partial_tax,
                mismatch_tax: +row.mismatch_tax,
                invoices: []
            };

            periodMap[p].categories.push(cat);
            catMap[`${p}__${row.category}`] = cat;

            // Accumulate period totals
            periodMap[p].books.count += +row.books_count;
            periodMap[p].books.tax += +row.books_tax;
            periodMap[p].books.igst += +row.books_igst;
            periodMap[p].books.cgst += +row.books_cgst;
            periodMap[p].books.sgst += +row.books_sgst;
            periodMap[p].books.cess += +row.books_cess;

            periodMap[p].gstr2a.count += +row.gstr_count;
            periodMap[p].gstr2a.tax += +row.gstr_tax;
            periodMap[p].gstr2a.igst += +row.gstr_igst;
            periodMap[p].gstr2a.cgst += +row.gstr_cgst;
            periodMap[p].gstr2a.sgst += +row.gstr_sgst;
            periodMap[p].gstr2a.cess += +row.gstr_cess;

            periodMap[p].book_tax += +row.books_tax;
            periodMap[p].gst_tax += +row.gstr_tax;
            periodMap[p].matched_tax += +row.matched_tax;
            periodMap[p].partial_tax += +row.partial_tax;
            periodMap[p].mismatch_tax += +row.mismatch_tax;
        });

        // Add invoices to their respective categories
        rows.forEach(row => {
            const key = `${row.period}__${row.category}`;
            if (catMap[key]) {
                catMap[key].invoices.push({
                    ...row,
                    books_tax: +row.books_tax,
                    books_igst: +row.books_igst,
                    books_cgst: +row.books_cgst,
                    books_sgst: +row.books_sgst,
                    books_cess: +row.books_cess,
                    gstr_tax: +row.gstr_tax,
                    gstr2a_tax: +row.gstr2a_tax,
                    gstr2a_igst: +row.gstr2a_igst,
                    gstr2a_cgst: +row.gstr2a_cgst,
                    gstr2a_sgst: +row.gstr2a_sgst,
                    gstr2a_cess: +row.gstr2a_cess,
                    gstr_igst: +row.gstr_igst,
                    gstr_cgst: +row.gstr_cgst,
                    gstr_sgst: +row.gstr_sgst,
                    gstr_cess: +row.gstr_cess
                });
            }
        });

        const grand = {
            books: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
            gstr2a: { count: 0, tax: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
        };

        Object.values(periodMap).forEach(p => {
            ['count', 'tax', 'igst', 'cgst', 'sgst', 'cess'].forEach(k => {
                grand.books[k] += p.books[k];
                grand.gstr2a[k] += p.gstr2a[k];
            });
        });

        // Sort periods and categories
        const sortedPeriods = Object.values(periodMap).sort((a, b) => {
            if (a.period === '000000') return 1;
            if (b.period === '000000') return -1;
            // MMYYYY -> YYYYMM
            const pA = a.period.substring(2) + a.period.substring(0, 2);
            const pB = b.period.substring(2) + b.period.substring(0, 2);
            return pA.localeCompare(pB);
        });

        sortedPeriods.forEach(p => {
            p.categories.sort((a, b) => a.category.localeCompare(b.category));
        });

        return {
            periods: sortedPeriods,
            grand
        };
    }

    static async ensureTaxPeriodExists(period, trx) {
        // Reuse common logic if possible, or duplicate for now to ensure isolation
        const db = trx || knex;
        const exists = await db('tax_periods').where({ period_code: period }).first();
        if (exists) return exists.id;
        // Logic to create...
        return null; // Simplified placeholder
    }
    static normalizeInvoiceNumber(num) {
        if (!num) return '';
        return num.toString().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
    }

    static areCategoriesCompatible(pCat, gCat) {
        if (!pCat || !gCat) return false;
        const validTypes = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'IMPORT', 'ISD'];
        return validTypes.includes(pCat) && validTypes.includes(gCat);
    }
}

module.exports = Reconciliation2AModel;
