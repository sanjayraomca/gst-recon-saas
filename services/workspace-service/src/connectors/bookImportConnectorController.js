const db = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { publishMessage } = require('../../../shared/src/nats/client');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');

// Self-contained model — same SQL as BookModel + GSTRImportModel in upload-service
// but lives inside workspace-service container (no cross-service file dependency)
const ConnectorImportModel = require('./connectorImportModel');

/**
 * ConnectorBookImportController
 *
 * Handles inbound JSON book data pushes from ERP connectors
 * (Tally, Zoho Books, SAP, QuickBooks, etc.).
 *
 * Authentication: X-API-Key header (validated by apiKeyMiddleware)
 *   → req.connectorContext = { workspaceId, tenantId, mode, keyType }
 *
 * Supported types:
 *   - purchase_register  → purchase_vouchers + purchase_items
 *   - sales_register     → sales_invoices + sales_invoice_items
 *   - purchase_return    → purchase_vouchers (book_type = PR)
 *   - sales_return       → sales_invoices   (book_type = SR)
 *
 * The JSON field names match what ERP connectors typically export:
 *   purchase: vchr_no, vchr_date, supplier_name, supplier_gstin, taxable_value, igst, cgst, sgst, cess, total_value
 *   sales:    invoice_no, invoice_date, party_name, party_gstin, taxable_value, igst, cgst, sgst, cess, total_value
 */

const VALID_TYPES = ['purchase_register', 'sales_register', 'purchase_return', 'sales_return'];

const TYPE_TO_BOOK = {
    purchase_register: 'PURCHASE',
    purchase_return:   'PURCHASE_RETURN',
    sales_register:    'SALES',
    sales_return:      'SALES_RETURN'
};

const TYPE_TO_IMPORT_TYPE = {
    purchase_register: 'PURCHASE_REGISTER',
    purchase_return:   'PURCHASE_REGISTER',
    sales_register:    'SALES_REGISTER',
    sales_return:      'SALES_REGISTER'
};


// ─────────────────────────────────────────────────────────────────────────────
// JSON → BookModel format mappers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a single incoming purchase JSON record into the { header, items } format
 * that BookModel.bulkInsertPurchase() expects.
 */
const mapPurchaseRecord = (record, tenantId, workspaceId, returnPeriod) => {
    const header = {
        tenant_id:               tenantId,
        workspace_id:            workspaceId,

        // Voucher identity
        book_vchr_no:            String(record.vchr_no || record.voucher_no || '').trim(),
        book_vchr_date:          record.vchr_date || record.voucher_date || null,

        // Supplier
        supplier_name:           String(record.supplier_name || record.party_name || '').trim(),
        supplier_gstin:          String(record.supplier_gstin || record.party_gstin || '').trim().toUpperCase() || null,
        // supplier_invoice_no is NOT NULL in purchase_vouchers — fall back to vchr_no if not separately supplied
        supplier_invoice_no:     String(record.supplier_invoice_no || record.vchr_no || record.voucher_no || '').trim(),
        supplier_invoice_date:   record.supplier_invoice_date || record.vchr_date || null,

        // Tax amounts
        taxable_total:           parseFloat(record.taxable_value || record.taxable_amount || 0),
        total_igst_amount:       parseFloat(record.igst || record.igst_amount || 0),
        total_cgst_amount:       parseFloat(record.cgst || record.cgst_amount || 0),
        total_sgst_amount:       parseFloat(record.sgst || record.sgst_amount || 0),
        total_cess_amount:       parseFloat(record.cess || record.cess_amount || 0),
        net_amount:              parseFloat(record.total_value || record.net_amount || record.invoice_value || 0),
        round_off:               parseFloat(record.round_off || 0),
        discount:                parseFloat(record.discount || 0),
        total_qty:               parseFloat(record.total_qty || 0),

        // GST fields
        place_of_supply:         record.place_of_supply || null,
        is_interstate:           record.is_interstate ? 'Yes' : 'No',
        is_rcm:                  record.is_rcm || false,
        voucher_type:            record.voucher_type || null,
        // Valid book_type values in purchase_vouchers: 'PA' (purchase), 'EXP' (expense), 'CN', 'DN'
        // purchase_return maps to 'DN' (debit note) as the nearest equivalent
        book_type:               record.book_type || 'PA',
        gstr_category:           record.gstr_category || null,
        source_section:          record.source_section || null,
        status:                  record.status || 'DRAFT',
        remarks:                 record.remarks || null,
        itc_eligible:            record.itc_eligible !== undefined ? record.itc_eligible : null,
        itc_claimed:             record.itc_claimed !== undefined ? record.itc_claimed : null,

        // Period
        filing_period:           record.filing_period || returnPeriod,
        return_period:           returnPeriod,
        tax_period_id:           null, // resolved dynamically by BookModel

        // Amendment fields
        is_amendment:            record.is_amendment || false,
        original_supplier_invoice_no:   record.original_supplier_invoice_no || null,
        original_supplier_invoice_date: record.original_supplier_invoice_date || null,
        original_book_vchr_no:          record.original_book_vchr_no || null,
        original_book_vchr_date:        record.original_book_vchr_date || null,
        original_net_amount:            parseFloat(record.original_net_amount || 0),
        return_date:                    record.return_date || null,
        original_return_period:         record.original_return_period || null,
        original_return_date:           record.original_return_date || null,

        t_extra_info: { source: 'api_connector', connector_ref: record.connector_ref || null }
    };

    // Items — optional line-item breakdown
    const items = (record.items || []).map(item => ({
        hsn_code:               String(item.hsn_code || item.hsn || '').trim() || null,
        description:            item.description || null,
        quantity:               parseFloat(item.quantity || item.qty || 0),
        uom:                    item.uom || null,
        unit_rate:              parseFloat(item.unit_rate || item.rate || 0),
        taxable_amount:         parseFloat(item.taxable_value || item.taxable_amount || 0),
        tax_per:                parseFloat(item.tax_rate || item.gst_rate || item.tax_per || 0),
        igst_amount:            parseFloat(item.igst || item.igst_amount || 0),
        cgst_amount:            parseFloat(item.cgst || item.cgst_amount || 0),
        sgst_amount:            parseFloat(item.sgst || item.sgst_amount || 0),
        cess_amount:            parseFloat(item.cess || item.cess_amount || 0),
        total_amount_with_tax:  parseFloat(item.total_value || item.total_amount_with_tax || 0),
        original_taxable_amount: parseFloat(item.original_taxable_amount || 0),
        original_igst_amount:    parseFloat(item.original_igst_amount || 0),
        original_cgst_amount:    parseFloat(item.original_cgst_amount || 0),
        original_sgst_amount:    parseFloat(item.original_sgst_amount || 0),
        original_cess_amount:    parseFloat(item.original_cess_amount || 0),
        original_tax_per:        parseFloat(item.original_tax_per || 0),
        t_extra_info: {}
    }));

    return { header, items };
};


/**
 * Map a single incoming sales JSON record into the { header, items } format
 * that BookModel.bulkInsertSales() expects.
 */
const mapSalesRecord = (record, tenantId, workspaceId, returnPeriod) => {
    const header = {
        tenant_id:              tenantId,
        workspace_id:           workspaceId,

        // Invoice identity
        invoice_number:         String(record.invoice_no || record.vchr_no || record.invoice_number || '').trim(),
        invoice_date:           record.invoice_date || record.vchr_date || null,
        invoice_type:           record.invoice_type || 'B2B',
        book_type:              record.book_type || 'SA',

        // Customer
        customer_name:          String(record.party_name || record.customer_name || '').trim(),
        customer_gstin:         String(record.party_gstin || record.customer_gstin || '').trim().toUpperCase() || null,

        // Tax amounts
        total_taxable_value:    parseFloat(record.taxable_value || record.taxable_amount || 0),
        total_igst:             parseFloat(record.igst || record.igst_amount || 0),
        total_cgst:             parseFloat(record.cgst || record.cgst_amount || 0),
        total_sgst:             parseFloat(record.sgst || record.sgst_amount || 0),
        total_cess:             parseFloat(record.cess || record.cess_amount || 0),
        total_invoice_value:    parseFloat(record.total_value || record.invoice_value || record.net_amount || 0),
        round_off:              parseFloat(record.round_off || 0),

        // GST fields
        place_of_supply:        record.place_of_supply || null,
        reverse_charge:         record.reverse_charge || false,
        gstr_category:          record.gstr_category || null,
        source_section:         record.source_section || null,

        // Period
        filing_period:          record.filing_period || returnPeriod,
        return_period:          returnPeriod,
        tax_period_id:          null, // resolved dynamically by BookModel

        // Amendment fields
        is_amendment:           record.is_amendment || false,
        original_invoice_no:    record.original_invoice_no || null,
        original_invoice_date:  record.original_invoice_date || null,
        original_book_vchr_no:  record.original_book_vchr_no || null,
        original_book_vchr_date:record.original_book_vchr_date || null,
        original_net_amount:    parseFloat(record.original_net_amount || 0),
        return_date:            record.return_date || null,
        original_return_period: record.original_return_period || null,
        original_return_date:   record.original_return_date || null,

        t_extra_info: { source: 'api_connector', connector_ref: record.connector_ref || null }
    };

    const items = (record.items || []).map(item => ({
        hsn_sac_code:           String(item.hsn_sac_code || item.hsn || '').trim() || null,
        description:            item.description || null,
        quantity:               parseFloat(item.quantity || item.qty || 0),
        uom:                    item.uom || null,
        unit_rate:              parseFloat(item.unit_rate || item.rate || 0),
        taxable_value:          parseFloat(item.taxable_value || item.taxable_amount || 0),
        gst_rate_percent:       parseFloat(item.tax_rate || item.gst_rate || 0),
        igst_amount:            parseFloat(item.igst || item.igst_amount || 0),
        cgst_amount:            parseFloat(item.cgst || item.cgst_amount || 0),
        sgst_amount:            parseFloat(item.sgst || item.sgst_amount || 0),
        cess_amount:            parseFloat(item.cess || item.cess_amount || 0),
        total_amount_with_tax:  parseFloat(item.total_value || item.total_amount_with_tax || 0),
        original_taxable_value: parseFloat(item.original_taxable_value || 0),
        original_igst_amount:   parseFloat(item.original_igst_amount || 0),
        original_cgst_amount:   parseFloat(item.original_cgst_amount || 0),
        original_sgst_amount:   parseFloat(item.original_sgst_amount || 0),
        original_cess_amount:   parseFloat(item.original_cess_amount || 0),
        original_gst_rate_percent: parseFloat(item.original_gst_rate_percent || 0),
        t_extra_info: {}
    }));

    return { header, items };
};


// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /connectors/book-import
 *
 * Accepts JSON book data from an ERP connector and imports it into the system.
 * Authentication: X-API-Key header (resolved by apiKeyMiddleware into req.connectorContext)
 *
 * Body:
 * {
 *   "type": "purchase_register" | "sales_register" | "purchase_return" | "sales_return",
 *   "return_period": "042026",      ← MMYYYY format (required)
 *   "records": [
 *     {
 *       // Purchase: vchr_no, vchr_date, supplier_name, supplier_gstin, taxable_value, igst, cgst, sgst, total_value
 *       // Sales:    invoice_no, invoice_date, party_name, party_gstin, taxable_value, igst, cgst, sgst, total_value
 *       "items": [ ... ]            ← optional line-item breakdown
 *     }
 *   ]
 * }
 */
const importBookData = async (req, res) => {
    try {
        // Context resolved by apiKeyMiddleware
        const { workspaceId, tenantId, mode, keyType } = req.connectorContext;

        const { type, return_period, records } = req.body;

        // ── Validate inputs ────────────────────────────────────────────────
        if (!type || !VALID_TYPES.includes(type)) {
            return errorResponse(res, `type is required. Valid values: ${VALID_TYPES.join(', ')}`, 400);
        }
        if (!return_period) {
            return errorResponse(res, 'return_period is required (format: MMYYYY, e.g. "042026")', 400);
        }
        if (!records || !Array.isArray(records) || records.length === 0) {
            return errorResponse(res, 'records array is required and must not be empty', 400);
        }
        if (records.length > 5000) {
            return errorResponse(res, 'Maximum 5000 records per request. Split into multiple batches.', 400);
        }

        const bookType    = TYPE_TO_BOOK[type];
        const importType  = TYPE_TO_IMPORT_TYPE[type];
        const isSales     = bookType === 'SALES' || bookType === 'SALES_RETURN';

        // ── Map incoming JSON → BookModel format ───────────────────────────
        const documents = records.map(record =>
            isSales
                ? mapSalesRecord(record, tenantId, workspaceId, return_period)
                : mapPurchaseRecord(record, tenantId, workspaceId, return_period)
        );

        // ── Create import tracking record ──────────────────────────────
        const importRecord = await ConnectorImportModel.createImportRecord({
            tenantUuid:   tenantId,
            workspaceId,
            returnPeriod: return_period,
            financialYear: TaxPeriodService.calculateFinancialYear(return_period),
            importType,
            extraInfo:    { source: 'api_connector', mode, keyType, record_count: records.length },
            userEmail:    'connector@api'
        });

        // ── Run the import ─────────────────────────────────────────
        let result;
        if (isSales) {
            result = await ConnectorImportModel.bulkInsertSales(documents);
        } else {
            result = await ConnectorImportModel.bulkInsertPurchase(documents);
        }

        // ── Handle empty result ────────────────────────────────────────
        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'No valid records found in payload'
            });
            return errorResponse(res, 'No valid records found in the submitted payload. Check field names and values.', 400);
        }

        // ── Update import tracking ───────────────────────────────────────
        await ConnectorImportModel.updateImportStatus(
            importRecord.import_filing_id,
            'Completed',
            result.inserted,
            {
                added_invoices:     result.addedInvoices,
                duplicate_invoices: result.duplicateInvoices
            }
        );

        // ── Publish NATS event (triggers reconciliation if configured) ─────
        try {
            await publishMessage('book-data-imported', JSON.stringify({
                tenant_id:    tenantId,
                workspace_id: workspaceId,
                period:       return_period,
                type:         bookType,
                count:        result.inserted,
                source:       'api_connector'
            }));
        } catch (natsErr) {
            // Non-fatal — import succeeded even if reconciliation trigger fails
            console.warn('[ConnectorBookImport] NATS publish failed (non-fatal):', natsErr.message);
        }

        // ── Activity log ───────────────────────────────────────────────────
        await logActivity({
            userId:      null,
            tenantId:    tenantId,
            workspaceId: workspaceId,
            actionType:  `CONNECTOR_${bookType}_IMPORT`,
            entityType:  'BookData',
            details: {
                type,
                return_period,
                mode,
                key_type:         keyType,
                records_received: records.length,
                records_inserted: result.inserted,
                records_skipped:  result.duplicateInvoices.length,
                import_id:        importRecord.import_filing_id
            },
            req
        });

        return successResponse(res, {
            import_id:         importRecord.import_filing_id,
            type,
            return_period,
            mode,                                          // "live" or "demo" — driven by which key was used
            records_received:  records.length,
            records_inserted:  result.inserted,
            records_updated:   result.duplicateInvoices.length,
            added_refs:        result.addedInvoices,
            updated_refs:      result.duplicateInvoices
        }, `Import successful: ${result.inserted} records inserted, ${result.duplicateInvoices.length} updated`);

    } catch (error) {
        console.error('[ConnectorBookImport.importBookData]', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = { importBookData };
