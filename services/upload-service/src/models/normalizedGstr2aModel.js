'use strict';

const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');

/**
 * Generate a deterministic UUID from the given parts.
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
 * NormalizedGstr2aModel
 * Converts section-specific GSTR-2A records into the unified
 * normalized_gstr2a_invoices table during the import pipeline.
 */
class NormalizedGstr2aModel {

    static mapB2B(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'B2B', r.gstin_supplier, r.invoice_number, r.invoice_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'B2B',
            source_table: sourceTable || 'gstr_2a_b2b_invoices',
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
            total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0),
            itc_available: r.itc_availability === 'Yes',
            itc_eligibility: r.itc_availability || null,
            itc_reason: r.itc_availability_reason || null,
            applicable_tax_rate_percent: (r.applicable_tax_rate && parseFloat(r.applicable_tax_rate) < 100) ? parseFloat(r.applicable_tax_rate) :
                (r.taxable_value > 0 ? Math.round(((parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0)) / parseFloat(r.taxable_value) * 100) : null),
            return_period: returnPeriod,
            filing_period: r.supplier_filing_period || null,
            filing_date: r.supplier_filing_date || null,
            source_type: 'PORTAL',
            irn: r.irn || null,
            irn_date: r.irn_date || null,
        }));
    }

    static mapB2BA(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'B2BA', r.gstin_supplier, r.revised_invoice_number, r.revised_invoice_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'B2BA',
            source_table: sourceTable || 'gstr_2a_b2ba_invoices',
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
            total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0),
            itc_available: r.itc_availability === 'Yes',
            itc_eligibility: r.itc_availability || null,
            applicable_tax_rate_percent: (r.applicable_tax_rate && parseFloat(r.applicable_tax_rate) < 100) ? parseFloat(r.applicable_tax_rate) :
                (r.taxable_value > 0 ? Math.round(((parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0)) / parseFloat(r.taxable_value) * 100) : null),
            return_period: returnPeriod,
            filing_period: r.supplier_filing_period || null,
            filing_date: r.supplier_filing_date || null,
            source_type: 'PORTAL',
        }));
    }

    static mapCDNR(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => {
            const noteType = (r.note_type || '').toString().toUpperCase();
            const docCategory = noteType.startsWith('D') ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
            return {
                source_row_id: makeSourceRowId(importFilingId, 'CDNR', r.gstin_supplier, r.note_number, r.note_date),
                workspace_id: workspaceId,
                tenant_id: tenantId,
                import_filing_id: importFilingId,
                source_section: 'CDNR',
                source_table: sourceTable || 'gstr_2a_cdnr',
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
                total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0),
                itc_available: r.itc_availability === 'Yes',
                itc_eligibility: r.itc_availability || null,
                itc_reason: r.itc_availability_reason || null,
                applicable_tax_rate_percent: (r.applicable_tax_rate && parseFloat(r.applicable_tax_rate) < 100) ? parseFloat(r.applicable_tax_rate) :
                    (r.taxable_value > 0 ? Math.round(((parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0)) / parseFloat(r.taxable_value) * 100) : null),
                return_period: returnPeriod,
                filing_period: r.supplier_filing_period || null,
                filing_date: r.supplier_filing_date || null,
                source_type: 'PORTAL',
            };
        });
    }

    static mapCDNRA(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => {
            const noteType = (r.note_type || '').toString().toUpperCase();
            const docCategory = noteType.startsWith('D') ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
            return {
                source_row_id: makeSourceRowId(importFilingId, 'CDNRA', r.gstin_supplier, r.revised_note_number, r.revised_note_date),
                workspace_id: workspaceId,
                tenant_id: tenantId,
                import_filing_id: importFilingId,
                source_section: 'CDNRA',
                source_table: sourceTable || 'gstr_2a_cdnra',
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
                total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0),
                itc_available: r.itc_availability === 'Yes',
                itc_eligibility: r.itc_availability || null,
                applicable_tax_rate_percent: (r.applicable_tax_rate && parseFloat(r.applicable_tax_rate) < 100) ? parseFloat(r.applicable_tax_rate) :
                    (r.taxable_value > 0 ? Math.round(((parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0)) / parseFloat(r.taxable_value) * 100) : null),
                return_period: returnPeriod,
                filing_period: r.supplier_filing_period || null,
                filing_date: r.supplier_filing_date || null,
                source_type: 'PORTAL',
            };
        });
    }

    static mapIMPG(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, 'IMPG', r.port_code, r.boe_number, r.boe_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: 'IMPG',
            source_table: sourceTable || 'gstr_2a_impg',
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
            total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.cess) || 0),
            itc_available: r.itc_availability === 'Yes',
            itc_reason: r.itc_availability_reason || null,
            applicable_tax_rate_percent: (r.applicable_tax_rate && parseFloat(r.applicable_tax_rate) < 100) ? parseFloat(r.applicable_tax_rate) :
                (r.taxable_value > 0 ? Math.round(((parseFloat(r.integrated_tax) || 0) + (parseFloat(r.cess) || 0)) / parseFloat(r.taxable_value) * 100) : null),
            return_period: returnPeriod,
            source_type: 'PORTAL',
        }));
    }

    static mapISD(records, { tenantId, workspaceId, importFilingId, returnPeriod, sourceTable }) {
        return records.map(r => ({
            source_row_id: makeSourceRowId(importFilingId, r.is_amended ? 'ISDA' : 'ISD', r.gstin_isd, r.document_number, r.document_date),
            workspace_id: workspaceId,
            tenant_id: tenantId,
            import_filing_id: importFilingId,
            source_section: r.is_amended ? 'ISDA' : 'ISD',
            source_table: sourceTable || 'gstr_2a_isd',
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
            total_tax: (parseFloat(r.integrated_tax) || 0) + (parseFloat(r.central_tax) || 0) + (parseFloat(r.state_ut_tax) || 0) + (parseFloat(r.cess) || 0),
            itc_available: r.itc_availability === 'Yes',
            return_period: returnPeriod,
            source_type: 'PORTAL',
        }));
    }

    /**
     * Check which source_row_ids already exist in the database.
     * @param {string[]} sourceRowIds 
     * @returns {Promise<Set<string>>}
     */
    static async checkExistingSourceIds(sourceRowIds) {
        if (!sourceRowIds || sourceRowIds.length === 0) return new Set();

        const query = `
            SELECT source_row_id 
            FROM normalized_gstr2a_invoices 
            WHERE source_row_id = ANY(?)
        `;
        try {
            const result = await db.raw(query, [sourceRowIds]);
            return new Set(result.rows.map(r => r.source_row_id));
        } catch (err) {
            console.error('[NormalizedGstr2aModel] checkExistingSourceIds error:', err.message);
            return new Set();
        }
    }

    static async batchInsert(rows) {
        if (!rows || rows.length === 0) return { inserted: 0, skipped: 0 };

        const sourceIds = rows.map(r => r.source_row_id);
        const existingIds = await this.checkExistingSourceIds(sourceIds);
        
        const newRows = rows.filter(r => !existingIds.has(r.source_row_id));
        const skippedCount = rows.length - newRows.length;

        if (newRows.length === 0) {
            return { inserted: 0, skipped: skippedCount };
        }

        const BATCH_SIZE = 500;
        let totalInserted = 0;

        for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
            const batch = newRows.slice(i, i + BATCH_SIZE);
            const columns = Object.keys(batch[0]);
            const placeholders = batch
                .map(() => `(${columns.map(() => '?').join(', ')})`)
                .join(', ');
            const values = batch.flatMap(row => columns.map(col => row[col] ?? null));

            const query = `
                INSERT INTO normalized_gstr2a_invoices (${columns.join(', ')})
                VALUES ${placeholders}
                ON CONFLICT (source_row_id) 
                DO NOTHING
            `;

            try {
                const result = await db.raw(query, values);
                totalInserted += result.rowCount || 0;
            } catch (err) {
                console.error('[NormalizedGstr2aModel] batchInsert error:', err.message);
                throw err;
            }
        }

        console.log(`[NormalizedGstr2aModel] Inserted ${totalInserted} rows, skipped ${skippedCount} duplicates`);
        return { inserted: totalInserted, skipped: skippedCount };
    }
}

module.exports = NormalizedGstr2aModel;
