'use strict';

const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');

/**
 * Generate a deterministic UUID from the given parts.
 * Same inputs always → same UUID, guaranteeing idempotent normalization.
 * Format: MD5 hex → 8-4-4-4-12 UUID string.
 */
function makeSourceRowId(...parts) {
    const hash = crypto.createHash('md5')
        .update(parts.map(p => (p == null ? '' : String(p))).join('|'))
        .digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32)
    ].join('-');
}

/**
 * NormalizedGstr2bModel
 * Converts section-specific GSTR-2B records into the unified
 * normalized_gstr2b_invoices table during the import pipeline.
 */
class NormalizedGstr2bModel {

    // ─────────────────────────────────────────────────────────────
    // MAPPERS — one per GSTR-2B section
    // ─────────────────────────────────────────────────────────────

    /**
     * Map B2B invoice records → normalized rows
     */
    static mapB2B(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'B2B', r.gstin_supplier, r.invoice_number, r.invoice_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'B2B',
            source_table: 'gstr_2b_b2b_invoices',
            document_category: 'INVOICE',
            document_type: r.invoice_type || 'Regular',
            is_amendment: false,
            is_active: true,
            supplier_gstin: r.gstin_supplier,
            supplier_name: r.trade_name || null,
            place_of_supply: r.place_of_supply || null,
            reverse_charge: r.reverse_charge === 'Yes',
            document_number_raw: r.invoice_number_raw || r.invoice_number,
            document_number_clean: r.invoice_number,
            document_date: r.invoice_date,
            document_value: r.invoice_value || 0,
            taxable_value: r.taxable_value || 0,
            igst: r.integrated_tax || 0,
            cgst: r.central_tax || 0,
            sgst: r.state_ut_tax || 0,
            cess: r.cess || 0,
            itc_available: r.itc_availability === 'Yes',
            itc_eligibility: r.itc_availability || null,
            itc_reason: r.itc_availability_reason || null,
            applicable_tax_rate_percent: r.applicable_tax_rate ? parseFloat(r.applicable_tax_rate) : null,
            return_period: returnPeriod,
            filing_period: r.supplier_filing_period || null,
            filing_date: r.supplier_filing_date || null,
            source_type: 'PORTAL',
            irn: r.irn || null,
            irn_date: r.irn_date || null,
        }));
    }

    /**
     * Map B2BA (amended B2B) records → normalized rows
     */
    static mapB2BA(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'B2BA', r.gstin_supplier, r.revised_invoice_number, r.revised_invoice_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'B2BA',
            source_table: 'gstr_2b_b2ba_invoices',
            document_category: 'INVOICE',
            document_type: r.invoice_type || 'Regular',
            is_amendment: true,
            amended_document_number: r.original_invoice_number || null,
            amended_document_date: r.original_invoice_date || null,
            is_active: true,
            supplier_gstin: r.gstin_supplier,
            supplier_name: r.trade_name || null,
            place_of_supply: r.place_of_supply || null,
            reverse_charge: r.reverse_charge === 'Yes',
            document_number_clean: r.revised_invoice_number,
            document_date: r.revised_invoice_date || null,
            document_value: r.invoice_value || 0,
            original_invoice_number: r.original_invoice_number || null,
            original_invoice_date: r.original_invoice_date || null,
            taxable_value: r.taxable_value || 0,
            igst: r.integrated_tax || 0,
            cgst: r.central_tax || 0,
            sgst: r.state_ut_tax || 0,
            cess: r.cess || 0,
            itc_available: r.itc_availability === 'Yes',
            itc_eligibility: r.itc_availability || null,
            applicable_tax_rate_percent: r.applicable_tax_rate ? parseFloat(r.applicable_tax_rate) : null,
            return_period: returnPeriod,
            filing_period: r.supplier_filing_period || null,
            filing_date: r.supplier_filing_date || null,
            source_type: 'PORTAL',
        }));
    }

    /**
     * Map CDNR (Credit/Debit Notes) records → normalized rows
     */
    static mapCDNR(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => {
            const noteType = (r.note_type || '').toString().toUpperCase();
            const docCategory = noteType.startsWith('D') ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
            return {
                source_row_id: makeSourceRowId(importFilingId, 'CDNR', r.gstin_supplier, r.note_number, r.note_date),
                workspace_id: workspaceId,
                tenant_id: tenantId,
                import_filing_id: importFilingId,
                source_section: 'CDNR',
                source_table: 'gstr_2b_cdnr',
                document_category: docCategory,
                document_type: r.note_type || null,
                is_amendment: false,
                is_active: true,
                supplier_gstin: r.gstin_supplier,
                supplier_name: r.trade_name || null,
                place_of_supply: r.place_of_supply || null,
                reverse_charge: r.reverse_charge === 'Yes',
                document_number_clean: r.note_number,
                document_date: r.note_date || null,
                document_value: r.note_value || 0,
                original_invoice_number: r.original_invoice_number || null,
                original_invoice_date: r.original_invoice_date || null,
                taxable_value: r.taxable_value || 0,
                igst: r.integrated_tax || 0,
                cgst: r.central_tax || 0,
                sgst: r.state_ut_tax || 0,
                cess: r.cess || 0,
                itc_available: r.itc_availability === 'Yes',
                itc_eligibility: r.itc_availability || null,
                itc_reason: r.itc_availability_reason || null,
                applicable_tax_rate_percent: r.applicable_tax_rate ? parseFloat(r.applicable_tax_rate) : null,
                return_period: returnPeriod,
                filing_period: r.supplier_filing_period || null,
                filing_date: r.supplier_filing_date || null,
                source_type: 'PORTAL',
            };
        });
    }

    /**
     * Map CDNRA (amended Credit/Debit Notes) records → normalized rows
     */
    static mapCDNRA(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => {
            const noteType = (r.note_type || '').toString().toUpperCase();
            const docCategory = noteType.startsWith('D') ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
            return {
                source_row_id: makeSourceRowId(importFilingId, 'CDNRA', r.gstin_supplier, r.revised_note_number, r.revised_note_date),
                workspace_id: workspaceId,
                tenant_id: tenantId,
                import_filing_id: importFilingId,
                source_section: 'CDNRA',
                source_table: 'gstr_2b_cdnra',
                document_category: docCategory,
                document_type: r.note_type || null,
                is_amendment: true,
                amended_document_number: r.original_note_number || null,
                is_active: true,
                supplier_gstin: r.gstin_supplier,
                supplier_name: r.trade_name || null,
                place_of_supply: r.place_of_supply || null,
                reverse_charge: r.reverse_charge === 'Yes',
                document_number_clean: r.revised_note_number,
                document_date: r.revised_note_date || null,
                document_value: r.note_value || 0,
                original_invoice_number: r.original_invoice_number || null,
                original_invoice_date: r.original_invoice_date || null,
                taxable_value: r.taxable_value || 0,
                igst: r.integrated_tax || 0,
                cgst: r.central_tax || 0,
                sgst: r.state_ut_tax || 0,
                cess: r.cess || 0,
                itc_available: r.itc_availability === 'Yes',
                itc_eligibility: r.itc_availability || null,
                applicable_tax_rate_percent: r.applicable_tax_rate ? parseFloat(r.applicable_tax_rate) : null,
                return_period: returnPeriod,
                filing_period: r.supplier_filing_period || null,
                filing_date: r.supplier_filing_date || null,
                source_type: 'PORTAL',
            };
        });
    }

    /**
     * Map IMPG (Imports via Bill of Entry) records → normalized rows
     */
    static mapIMPG(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'IMPG', r.port_code, r.boe_number, r.boe_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'IMPG',
            source_table: 'gstr_2b_impg',
            document_category: 'IMPORT',
            is_amendment: false,
            is_active: true,
            port_code: r.port_code || null,
            boe_number: r.boe_number || null,
            boe_date: r.boe_date || null,
            icegate_reference_date: r.icegate_ref_date || null,
            taxable_value: r.taxable_value || 0,
            igst: r.integrated_tax || 0,
            cess: r.cess || 0,
            cgst: 0,
            sgst: 0,
            itc_available: r.itc_availability === 'Yes',
            itc_reason: r.itc_availability_reason || null,
            applicable_tax_rate_percent: r.applicable_tax_rate ? parseFloat(r.applicable_tax_rate) : null,
            return_period: returnPeriod,
            source_type: 'PORTAL',
        }));
    }

    /**
     * Map ISD (Input Service Distributor) records → normalized rows
     */
    static mapISD(records, { tenantId, workspaceId, importFilingId, returnPeriod }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, r.is_amended ? 'ISDA' : 'ISD', r.gstin_isd, r.document_number, r.document_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: r.is_amended ? 'ISDA' : 'ISD',
            source_table: 'gstr_2b_isd',
            document_category: 'ISD',
            document_type: r.document_type || null,
            is_amendment: r.is_amended || false,
            is_active: true,
            supplier_gstin: r.gstin_isd || null,
            supplier_name: r.isd_name || null,
            isd_document_number: r.document_number || null,
            isd_document_date: r.document_date || null,
            original_invoice_number: r.original_document_number || null,
            original_invoice_date: r.original_document_date || null,
            taxable_value: 0,
            igst: r.integrated_tax || 0,
            cgst: r.central_tax || 0,
            sgst: r.state_ut_tax || 0,
            cess: r.cess || 0,
            itc_available: r.itc_availability === 'Yes',
            return_period: returnPeriod,
            source_type: 'PORTAL',
        }));
    }

    // ─────────────────────────────────────────────────────────────
    // INSERT
    // ─────────────────────────────────────────────────────────────

    /**
     * Batch-insert normalized rows into normalized_gstr2b_invoices.
     * ON CONFLICT (import_filing_id, source_section, source_row_id) DO NOTHING
     * makes normalization fully idempotent on re-runs.
     * @param {object[]} rows
     * @returns {Promise<{ inserted: number }>}
     */
    static async batchInsert(rows) {
        if (!rows || rows.length === 0) return { inserted: 0 };

        const BATCH_SIZE = 500;
        let totalInserted = 0;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const columns = Object.keys(batch[0]);
            const placeholders = batch
                .map(() => `(${columns.map(() => '?').join(', ')})`)
                .join(', ');
            const values = batch.flatMap(row => columns.map(col => row[col] ?? null));

            const query = `
                INSERT INTO normalized_gstr2b_invoices (${columns.join(', ')})
                VALUES ${placeholders}
                ON CONFLICT (import_filing_id, source_section, source_row_id)
                DO NOTHING
            `;

            try {
                const result = await db.raw(query, values);
                totalInserted += result.rowCount || 0;
            } catch (err) {
                console.error('[NormalizedGstr2bModel] batchInsert error:', err.message);
                throw err;
            }
        }

        console.log(`[NormalizedGstr2bModel] Inserted ${totalInserted} normalized rows`);
        return { inserted: totalInserted };
    }

    // ─────────────────────────────────────────────────────────────
    // LISTING — reads from v_gstr2b_listing view
    // ─────────────────────────────────────────────────────────────

    /**
     * Paginated listing of normalized GSTR-2B invoices for a workspace.
     *
     * @param {object} filters
     * @param {string}  filters.workspaceId   - required
     * @param {string}  [filters.returnPeriod] - MMYYYY
     * @param {string}  [filters.sourceSection] - B2B | B2BA | CDNR | CDNRA | IMPG | ISD | ISDA
     * @param {string}  [filters.supplierGstin]
     * @param {string}  [filters.documentNumber]
     * @param {boolean} [filters.itcAvailable]
     * @param {string}  [filters.fromDate]
     * @param {string}  [filters.toDate]
     * @param {string|number} [filters.minAmount]
     * @param {string|number} [filters.maxAmount]
     * @param {string}  [filters.stateCodes] - Comma separated state codes
     * @param {number}  [filters.page=1]
     * @param {number}  [filters.pageSize=50]
     * @returns {Promise<{ rows, total, page, pageSize, totalPages }>}
     */
    static async listInvoices(filters = {}) {
        const {
            workspaceId,
            returnPeriod,
            sourceSection,
            supplierGstin,
            documentNumber,
            itcAvailable,
            fromDate,
            toDate,
            minAmount,
            maxAmount,
            stateCodes,
            sortBy,
            sortOrder = 'asc',
            importType,
            page = 1,
            pageSize = 50,
        } = filters;

        if (!workspaceId) throw new Error('workspaceId is required for listInvoices');

        const PAGE_SIZE = Math.min(Math.max(parseInt(pageSize) || 50, 1), 500);
        const PAGE = Math.max(parseInt(page) || 1, 1);
        const OFFSET = (PAGE - 1) * PAGE_SIZE;

        // Build WHERE clauses dynamically
        const conditions = ['workspace_id = ?'];
        const params = [workspaceId];

        if (returnPeriod) {
            if (returnPeriod.startsWith('Q')) {
                const q = returnPeriod.substring(1, 2);
                const year = parseInt(returnPeriod.substring(2));
                let periods = [];
                if (q === '1') periods = [`04${year}`, `05${year}`, `06${year}`];
                else if (q === '2') periods = [`07${year}`, `08${year}`, `09${year}`];
                else if (q === '3') periods = [`10${year}`, `11${year}`, `12${year}`];
                else if (q === '4') {
                    const nextYear = year + 1;
                    periods = [`01${nextYear}`, `02${nextYear}`, `03${nextYear}`];
                }
                conditions.push('return_period = ANY(?)');
                params.push(periods);
            } else {
                conditions.push('return_period = ?');
                params.push(returnPeriod);
            }
        }
        if (sourceSection) {
            conditions.push('source_section = ?');
            params.push(sourceSection.toUpperCase());
        }
        if (supplierGstin) {
            conditions.push('supplier_gstin ILIKE ?');
            params.push(`%${supplierGstin}%`);
        }
        if (documentNumber) {
            conditions.push('(document_number_clean ILIKE ? OR document_number_raw ILIKE ?)');
            params.push(`%${documentNumber}%`, `%${documentNumber}%`);
        }
        if (itcAvailable !== undefined && itcAvailable !== null && itcAvailable !== '') {
            const val = itcAvailable === true || itcAvailable === 'true' || itcAvailable === '1';
            conditions.push('itc_available = ?');
            params.push(val);
        }
        if (fromDate) {
            conditions.push('document_date >= ?');
            params.push(fromDate);
        }
        if (toDate) {
            conditions.push('document_date <= ?');
            params.push(toDate);
        }
        if (minAmount !== undefined && minAmount !== null && minAmount !== '') {
            conditions.push('document_value >= ?');
            params.push(parseFloat(minAmount));
        }
        if (maxAmount !== undefined && maxAmount !== null && maxAmount !== '') {
            conditions.push('document_value <= ?');
            params.push(parseFloat(maxAmount));
        }
        if (stateCodes) {
            const states = stateCodes.split(',').map(s => s.trim()).filter(Boolean);
            if (states.length > 0) {
                const statePlaceholders = states.map(() => '?').join(',');
                conditions.push(`(substring(supplier_gstin from 1 for 2) IN (${statePlaceholders}) OR place_of_supply IN (${statePlaceholders}))`);
                params.push(...states, ...states);
            }
        }
        if (importType) {
            conditions.push('import_type = ?');
            params.push(importType.toUpperCase());
        }

        const whereClause = conditions.join(' AND ');

        // Count query
        const countResult = await db.raw(
            `SELECT COUNT(*) AS total FROM v_gstr_listing WHERE ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0]?.total || 0);

        // Sorting Logic
        let orderByClause = 'ORDER BY document_date DESC NULLS LAST, created_at DESC';
        const allowedSortColumns = {
            'invoice_number': 'document_number_clean',
            'date': 'document_date',
            'party_gstn': 'supplier_gstin',
            'taxable_amount': 'taxable_value',
            'tax_amount': 'total_tax'
        };

        if (sortBy && allowedSortColumns[sortBy]) {
            const dbColumn = allowedSortColumns[sortBy];
            const direction = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
            // Also add id sorting as secondary to ensure stable sort order
            orderByClause = `ORDER BY ${dbColumn} ${direction} NULLS LAST, document_date DESC, id ASC`;
        }

        // Data query
        const dataResult = await db.raw(
            `SELECT
                id, source_section, document_category, document_type,
                is_amendment, is_active,
                supplier_gstin, supplier_name, recipient_gstin,
                place_of_supply, reverse_charge,
                document_number_raw, document_number_clean,
                document_date, document_value,
                amended_document_number, amended_document_date,
                original_invoice_number, original_invoice_date,
                taxable_value, igst, cgst, sgst, cess, total_tax,
                itc_available, itc_eligibility, applicable_tax_rate_percent,
                return_period, filing_period, filing_date,
                irn, irn_date,
                original_filename, upload_timestamp, import_type,
                created_at
             FROM v_gstr_listing
             WHERE ${whereClause}
             ${orderByClause}
             LIMIT ? OFFSET ?`,
            [...params, PAGE_SIZE, OFFSET]
        );

        return {
            rows: dataResult.rows,
            total,
            page: PAGE,
            pageSize: PAGE_SIZE,
            totalPages: Math.ceil(total / PAGE_SIZE),
        };
    }

    /**
     * Aggregated summary of GSTR-2B invoices grouped by source_section.
     *
     * @param {object} filters
     * @param {string}  filters.workspaceId   - required
     * @param {string}  [filters.returnPeriod] - MMYYYY
     * @returns {Promise<Array<{ source_section, total_records, total_taxable, total_igst, total_cgst, total_sgst, total_cess, total_tax }>>}
     */
    static async getListingSummary(filters = {}) {
        const {
            workspaceId,
            returnPeriod,
            sourceSection,
            supplierGstin,
            documentNumber,
            itcAvailable,
            fromDate,
            toDate,
            minAmount,
            maxAmount,
            stateCodes,
            importType
        } = filters;

        if (!workspaceId) throw new Error('workspaceId is required for getListingSummary');

        const conditions = ['workspace_id = ?'];
        const params = [workspaceId];

        if (returnPeriod) {
            if (returnPeriod.startsWith('Q')) {
                const q = returnPeriod.substring(1, 2);
                const year = parseInt(returnPeriod.substring(2));
                let periods = [];
                if (q === '1') periods = [`04${year}`, `05${year}`, `06${year}`];
                else if (q === '2') periods = [`07${year}`, `08${year}`, `09${year}`];
                else if (q === '3') periods = [`10${year}`, `11${year}`, `12${year}`];
                else if (q === '4') {
                    const nextYear = year + 1;
                    periods = [`01${nextYear}`, `02${nextYear}`, `03${nextYear}`];
                }
                conditions.push('return_period = ANY(?)');
                params.push(periods);
            } else {
                conditions.push('return_period = ?');
                params.push(returnPeriod);
            }
        }
        if (sourceSection) {
            conditions.push('source_section = ?');
            params.push(sourceSection.toUpperCase());
        }
        if (supplierGstin) {
            conditions.push('supplier_gstin ILIKE ?');
            params.push(`%${supplierGstin}%`);
        }
        if (documentNumber) {
            conditions.push('(document_number_clean ILIKE ? OR document_number_raw ILIKE ?)');
            params.push(`%${documentNumber}%`, `%${documentNumber}%`);
        }
        if (itcAvailable !== undefined && itcAvailable !== null && itcAvailable !== '') {
            const val = itcAvailable === true || itcAvailable === 'true' || itcAvailable === '1';
            conditions.push('itc_available = ?');
            params.push(val);
        }
        if (fromDate) {
            conditions.push('document_date >= ?');
            params.push(fromDate);
        }
        if (toDate) {
            conditions.push('document_date <= ?');
            params.push(toDate);
        }
        if (minAmount !== undefined && minAmount !== null && minAmount !== '') {
            conditions.push('document_value >= ?');
            params.push(parseFloat(minAmount));
        }
        if (maxAmount !== undefined && maxAmount !== null && maxAmount !== '') {
            conditions.push('document_value <= ?');
            params.push(parseFloat(maxAmount));
        }
        if (stateCodes) {
            const states = stateCodes.split(',').map(s => s.trim()).filter(Boolean);
            if (states.length > 0) {
                const statePlaceholders = states.map(() => '?').join(',');
                conditions.push(`(substring(supplier_gstin from 1 for 2) IN (${statePlaceholders}) OR place_of_supply IN (${statePlaceholders}))`);
                params.push(...states, ...states);
            }
        }
        if (importType) {
            conditions.push('import_type = ?');
            params.push(importType.toUpperCase());
        }

        const whereClause = conditions.join(' AND ');

        const result = await db.raw(
            `SELECT
                source_section,
                COUNT(*)                        AS total_records,
                COALESCE(SUM(taxable_value), 0) AS total_taxable,
                COALESCE(SUM(igst),          0) AS total_igst,
                COALESCE(SUM(cgst),          0) AS total_cgst,
                COALESCE(SUM(sgst),          0) AS total_sgst,
                COALESCE(SUM(cess),          0) AS total_cess,
                COALESCE(SUM(total_tax),     0) AS total_tax
             FROM v_gstr_listing
             WHERE ${whereClause}
             GROUP BY source_section
             ORDER BY source_section`,
            params
        );

        return result.rows;
    }
}

module.exports = NormalizedGstr2bModel;
