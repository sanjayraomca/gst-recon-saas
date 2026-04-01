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
                    .whereIn('recon_run_id', function() {
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
            sort_by = 'created_at', sort_order = 'desc'
        } = filters;

        const query = knex('reconciliation_results as rr')
            .leftJoin('reconciliation_runs as run', 'rr.recon_run_id', 'run.id')
            .leftJoin('normalized_gstr2a_invoices as gi', 'rr.gstr2a_invoice_id', 'gi.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2a_invoices as sa', 'rr.gstr2a_source_id', 'sa.id')
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
            // Restrict to 2A-relevant run types to prevent data leakage from 2B runs
            query.whereIn('run.run_type', ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B']);
        }

        // Filters
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
                    .orWhere('sa.document_number_raw', 'ilike', `%${search}%`);
            });
        }

        // Totals
        const totalsResult = await query.clone().clearSelect().select(
            knex.raw('COUNT(*) as total_count'),
            knex.raw('SUM(COALESCE(pi.taxable_total, sa.taxable_value, 0)) as book_taxable_total'),
            knex.raw('SUM(COALESCE(gi.taxable_value, 0)) as gstr_taxable_total'),
            knex.raw('SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.total_tax, 0)) as book_tax_total'),
            knex.raw('SUM(COALESCE(gi.total_tax, 0)) as gstr_tax_total'),
            knex.raw('SUM(COALESCE(pi.total_cgst_amount, sa.cgst, 0)) as book_cgst_total'),
            knex.raw('SUM(COALESCE(pi.total_sgst_amount, sa.sgst, 0)) as book_sgst_total'),
            knex.raw('SUM(COALESCE(pi.total_cess_amount, sa.cess, 0)) as book_cess_total'),
            knex.raw('SUM(COALESCE(gi.cgst, 0)) as gstr_cgst_total'),
            knex.raw('SUM(COALESCE(gi.sgst, 0)) as gstr_sgst_total'),
            knex.raw('SUM(COALESCE(gi.cess, 0)) as gstr_cess_total')
        ).first();

        const total = parseInt(totalsResult.total_count || 0);

        query.select(
            'rr.*',
            knex.raw('COALESCE(pi.supplier_invoice_no, sa.document_number_raw) as purchase_invoice_number'),
            knex.raw('COALESCE(pi.supplier_invoice_date, sa.document_date) as purchase_invoice_date'),
            knex.raw('COALESCE(pi.supplier_name, sa.supplier_name) as purchase_supplier_name'),
            knex.raw('COALESCE(pi.supplier_gstin, sa.supplier_gstin) as purchase_gstin'),
            'gi.document_number_clean as gstr_invoice_number',
            'gi.document_number_raw as gstr_invoice_number_raw',
            'gi.document_date as gstr_invoice_date',
            knex.raw('COALESCE(pi.supplier_gstin, sa.supplier_gstin, gi.supplier_gstin) as supplier_gstin'),
            knex.raw('COALESCE(pi.supplier_name, sa.supplier_name, gi.supplier_name) as supplier_name'),
            'gi.taxable_value as gstr_taxable',
            'gi.total_tax as gstr_tax',
            'gi.igst as gstr_igst',
            'gi.cgst as gstr_cgst',
            'gi.sgst as gstr_sgst',
            'gi.cess as gstr_cess',
            knex.raw('COALESCE(pi.taxable_total, sa.taxable_value) as purchase_taxable'),
            knex.raw('(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.total_tax, 0)) as purchase_tax'),
            knex.raw('COALESCE(pi.total_igst_amount, sa.igst) as purchase_igst'),
            knex.raw('COALESCE(pi.total_cgst_amount, sa.cgst) as purchase_cgst'),
            knex.raw('COALESCE(pi.total_sgst_amount, sa.sgst) as purchase_sgst'),
            knex.raw('COALESCE(pi.total_cess_amount, sa.cess) as purchase_cess'),
            knex.raw('COALESCE(pi.net_amount, sa.total_tax + sa.taxable_value) as purchase_invoice_total'),
            knex.raw('COALESCE(pi.supplier_invoice_no, sa.document_number_raw) as book_vchr_no'),
            knex.raw('COALESCE(pi.gstr_category, pi.source_section, sa.source_section, gi.source_section) as gstr_category'),
            'gi.itc_available as gstr2a_itc_available',
            'gi.itc_eligibility as gstr2a_itc_eligibility',
            'gi.itc_reason as gstr2a_itc_reason',
            knex.raw("COALESCE(rs.recon_status, 'pending') as reconciliation_status")
        );

        // Sort mapping
        const sortColumnMap = {
            'date': 'pi.supplier_invoice_date',
            'invoice_date': 'pi.supplier_invoice_date',
            'gstr_date': 'gi.document_date',
            'amount': 'pi.net_amount',
            'supplier': 'pi.supplier_name',
            'match_status': 'rr.match_status',
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
        let aggQuery = knex('reconciliation_results as rr')
            .leftJoin('reconciliation_runs as run', 'rr.recon_run_id', 'run.id')
            .leftJoin('normalized_gstr2a_invoices as gi', 'rr.gstr2a_invoice_id', 'gi.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2a_invoices as sa', 'rr.gstr2a_source_id', 'sa.id')
            .where('rr.workspace_id', workspaceId);

        if (runId !== 'all') {
            aggQuery.where('rr.recon_run_id', runId);
        } else {
            aggQuery.whereIn('run.run_type', ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B']);
        }

        const totalsResult = await aggQuery.select(
            knex.raw('SUM(COALESCE(pi.taxable_total, sa.taxable_value, 0)) as purchase_taxable'),
            knex.raw('SUM(COALESCE(gi.taxable_value, 0)) as gstr_taxable'),
            knex.raw('SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0) + COALESCE(sa.total_tax, 0)) as purchase_tax'),
            knex.raw('SUM(COALESCE(gi.total_tax, 0)) as gstr_tax'),
            knex.raw('SUM(COALESCE(pi.total_cgst_amount, sa.cgst, 0)) as purchase_cgst'),
            knex.raw('SUM(COALESCE(pi.total_sgst_amount, sa.sgst, 0)) as purchase_sgst'),
            knex.raw('SUM(COALESCE(pi.total_cess_amount, sa.cess, 0)) as purchase_cess'),
            knex.raw('SUM(COALESCE(gi.cgst, 0)) as gstr_cgst'),
            knex.raw('SUM(COALESCE(gi.sgst, 0)) as gstr_sgst'),
            knex.raw('SUM(COALESCE(gi.cess, 0)) as gstr_cess')
        ).first();

        return {
            grand: {
                books: {
                    purchase_taxable: parseFloat(totalsResult.purchase_taxable || 0),
                    purchase_tax: parseFloat(totalsResult.purchase_tax || 0),
                    purchase_cgst: parseFloat(totalsResult.purchase_cgst || 0),
                    purchase_sgst: parseFloat(totalsResult.purchase_sgst || 0),
                    purchase_cess: parseFloat(totalsResult.purchase_cess || 0)
                },
                gstr2a: {
                    gstr_taxable: parseFloat(totalsResult.gstr_taxable || 0),
                    gstr_tax: parseFloat(totalsResult.gstr_tax || 0),
                    gstr_cgst: parseFloat(totalsResult.gstr_cgst || 0),
                    gstr_sgst: parseFloat(totalsResult.gstr_sgst || 0),
                    gstr_cess: parseFloat(totalsResult.gstr_cess || 0)
                }
            },
            periods: [] // Period-wise breakdown can be added if needed
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
