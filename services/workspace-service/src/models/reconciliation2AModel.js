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

            const VAR_DAYS_MIN = parseFloat(wsSettings.variance_days_min) || 2;
            const VAR_DAYS_MAX = parseFloat(wsSettings.variance_days_max) || 2;
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

            // --- Step 1: Strict Match ---
            for (const invA of sourceAInvoices) {
                const invNo = is2aVs2b ? invA.document_number_clean : invA.supplier_invoice_no;
                const taxA = is2aVs2b ? (parseFloat(invA.total_tax) || 0) : 
                    ((parseFloat(invA.total_igst_amount) || 0) + (parseFloat(invA.total_cgst_amount) || 0) + 
                     (parseFloat(invA.total_sgst_amount) || 0) + (parseFloat(invA.total_cess_amount) || 0));

                const matches = sourceBInvoices.filter(b => 
                    (b.document_number_clean === invNo || b.document_number_raw === invNo) && !matchedBIds.has(b.id)
                );

                if (matches.length > 0) {
                    const best = matches[0];
                    matchedBIds.add(best.id);
                    const taxB = parseFloat(best.total_tax) || 0;

                    matchResults.push(createMatchResult({
                        purchase_invoice_id: is2aVs2b ? null : invA.id,
                        gstr2a_source_id: is2aVs2b ? invA.id : null,
                        gstr2a_invoice_id: is2aVs2b ? null : best.id,
                        gstr2b_invoice_id: is2aVs2b ? best.id : null,
                        match_status: 'matched',
                        match_score: 100.00,
                        match_confidence: 'HIGH',
                        books_value: taxA,
                        portal_value: taxB,
                        variance_amount: Math.abs(taxA - taxB),
                        decision_reason: 'Strict Invoice Number Match'
                    }));
                } else {
                    unmatchedA.push(invA);
                }
            }

            // --- Step 2: Missing in Portal (Source B) ---
            for (const invA of unmatchedA) {
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

            // --- Step 3: Missing in Records (Source A) ---
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
                    await trx('reconciliation_results').where('workspace_id', workspaceId).where(function() {
                        if (pIds.length) this.orWhereIn('purchase_invoice_id', pIds);
                        if (g2aIds.length) this.orWhereIn('gstr2a_invoice_id', g2aIds);
                        if (g2asIds.length) this.orWhereIn('gstr2a_source_id', g2asIds);
                    }).delete();
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

                for (const row of statusRows) {
                    const existing = row.book_data_id
                        ? await trx('reconciliation_status_gst2a_vs_book')
                            .where({ workspace_id: workspaceId, book_data_id: row.book_data_id })
                            .first()
                        : await trx('reconciliation_status_gst2a_vs_book')
                            .where({ workspace_id: workspaceId, gstr_data_id: row.gstr_data_id })
                            .first();

                    if (existing) {
                        await trx('reconciliation_status_gst2a_vs_book')
                            .where({ id: existing.id })
                            .update({
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
            .leftJoin('normalized_gstr2a_invoices as gi', 'rr.gstr2a_invoice_id', 'gi.id')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('reconciliation_status_gst2a_vs_book as rs', function() {
                this.on('rr.workspace_id', '=', 'rs.workspace_id')
                    .andOn(function() {
                        this.on('rr.purchase_invoice_id', '=', 'rs.book_data_id')
                            .orOn('rr.gstr2a_invoice_id', '=', 'rs.gstr_data_id');
                    });
            })
            .where('rr.workspace_id', workspaceId);

        if (runId !== 'all') {
            query.where('rr.recon_run_id', runId);
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
            query.where(function() {
                this.where('pi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('gi.supplier_name', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_invoice_no', 'ilike', `%${search}%`)
                    .orWhere('gi.document_number_raw', 'ilike', `%${search}%`);
            });
        }

        // Totals
        const totalsResult = await query.clone().clearSelect().select(
            knex.raw('COUNT(*) as total_count'),
            knex.raw('SUM(COALESCE(pi.taxable_total, 0)) as book_taxable_total'),
            knex.raw('SUM(COALESCE(gi.taxable_value, 0)) as gstr_taxable_total'),
            knex.raw('SUM(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)) as book_tax_total'),
            knex.raw('SUM(COALESCE(gi.total_tax, 0)) as gstr_tax_total')
        ).first();

        const total = parseInt(totalsResult.total_count || 0);

        query.select(
            'rr.*',
            'pi.supplier_invoice_no as purchase_invoice_number',
            'pi.supplier_invoice_date as purchase_invoice_date',
            'pi.supplier_name as purchase_supplier_name',
            'pi.supplier_gstin as purchase_gstin',
            'gi.document_number_clean as gstr_invoice_number',
            'gi.document_number_raw as gstr_invoice_number_raw',
            'gi.document_date as gstr_invoice_date',
            knex.raw('COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin'),
            knex.raw('COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name'),
            'gi.taxable_value as gstr_taxable',
            'gi.total_tax as gstr_tax',
            'gi.igst as gstr_igst',
            'gi.cgst as gstr_cgst',
            'gi.sgst as gstr_sgst',
            'gi.cess as gstr_cess',
            'pi.taxable_total as book_taxable',
            knex.raw('(COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)) as book_tax'),
            'pi.net_amount as book_invoice_total',
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
                    book_taxable: parseFloat(totalsResult.book_taxable_total || 0),
                    gstr_taxable: parseFloat(totalsResult.gstr_taxable_total || 0),
                    book_tax: parseFloat(totalsResult.book_tax_total || 0),
                    gstr_tax: parseFloat(totalsResult.gstr_tax_total || 0)
                }
            }
        };
    }

    static async getRunTaxSummary(workspaceId, runId, filters = {}) {
        // Basic placeholder
        return { periods: [], grand: { books: {}, gstr2a: {} } };
    }

    static async ensureTaxPeriodExists(period, trx) {
        // Reuse common logic if possible, or duplicate for now to ensure isolation
        const db = trx || knex;
        const exists = await db('tax_periods').where({ period_code: period }).first();
        if (exists) return exists.id;
        // Logic to create...
        return null; // Simplified placeholder
    }
}

module.exports = Reconciliation2AModel;
