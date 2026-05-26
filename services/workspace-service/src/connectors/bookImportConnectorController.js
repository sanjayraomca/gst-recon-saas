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
    // Determine the voucher number: prefer vchr_full_number first, then vchr_no, voucher_no
    const vchrNo = String(record.vchr_full_number || record.vchr_no || record.voucher_no || '').trim();

    // Map voucher_type to valid column values: 'PURCHASE', 'EXPENSE', 'DEBIT_NOTE', 'CREDIT_NOTE', or null
    let dbVoucherType = 'PURCHASE';
    const incomingVType = String(record.vchr_type || record.voucher_type || '').toUpperCase();
    if (incomingVType.startsWith('PUR')) {
        dbVoucherType = 'PURCHASE';
    } else if (incomingVType === 'EXP' || incomingVType.includes('EXPENSE')) {
        dbVoucherType = 'EXPENSE';
    } else if (incomingVType === 'DN' || incomingVType.includes('DEBIT')) {
        dbVoucherType = 'DEBIT_NOTE';
    } else if (incomingVType === 'CN' || incomingVType.includes('CREDIT')) {
        dbVoucherType = 'CREDIT_NOTE';
    } else if (!incomingVType) {
        dbVoucherType = 'PURCHASE';
    }

    // Map book_type: valid values: 'PA' (purchase), 'EXP' (expense), 'CN', 'DN'
    let dbBookType = 'PA';
    if (incomingVType === 'EXP' || incomingVType.includes('EXPENSE')) {
        dbBookType = 'EXP';
    } else if (incomingVType === 'DN' || incomingVType.includes('DEBIT')) {
        dbBookType = 'DN';
    } else if (incomingVType === 'CN' || incomingVType.includes('CREDIT')) {
        dbBookType = 'CN';
    }

    const header = {
        tenant_id:               tenantId,
        workspace_id:            workspaceId,

        // Voucher identity
        book_vchr_no:            vchrNo,
        book_vchr_date:          record.vchr_date || record.voucher_date || null,

        // Supplier
        supplier_name:           String(record.party_name || record.supplier_name || '').trim(),
        supplier_gstin:          String(record.party_gstn_no || record.supplier_gstin || record.party_gstin || '').trim().toUpperCase() || null,
        // supplier_invoice_no is NOT NULL in purchase_vouchers — fall back to vchrNo
        supplier_invoice_no:     String(record.supplier_invoice_no || vchrNo || '').trim(),
        supplier_invoice_date:   record.supplier_invoice_date || record.vchr_date || null,

        // Tax amounts
        taxable_total:           parseFloat(record.total_taxable_amount || record.taxable_value || record.taxable_amount || 0),
        total_igst_amount:       parseFloat(record.total_igst_tax_amount || record.igst || record.igst_amount || 0),
        total_cgst_amount:       parseFloat(record.total_cgst_tax_amount || record.cgst || record.cgst_amount || 0),
        total_sgst_amount:       parseFloat(record.total_sgst_tax_amount || record.sgst || record.sgst_amount || 0),
        total_cess_amount:       parseFloat(record.total_cess_tax_amount || record.cess || record.cess_amount || 0),
        net_amount:              parseFloat(record.invoice_amount || record.row_wise_total_amount || record.total_value || record.net_amount || record.invoice_value || 0),
        round_off:               parseFloat(record.round_off_amount || record.round_off || 0),
        discount:                parseFloat(record.discount || 0),
        total_qty:               parseFloat(record.total_qty || 0),

        // GST fields
        place_of_supply:         record.place_of_supply || null,
        is_interstate:           record.inter_state || (record.is_interstate ? 'Yes' : 'No'),
        is_rcm:                  record.reverse_charge ? (record.reverse_charge.toLowerCase() === 'yes') : (record.is_rcm || false),
        voucher_type:            dbVoucherType,
        book_type:               dbBookType,
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
        is_amendment:            record.is_amendment ? (record.is_amendment.toLowerCase() === 'yes') : (record.is_amendment || false),
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
 * Helper: Log push sync actions (both success and fail) in activity_logs
 */
const logBookActivity = async (req, status, actionType, details) => {
    try {
        const context = req.connectorContext || {};
        await logActivity({
            userId: null,
            tenantId: context.tenantId || null,
            workspaceId: context.workspaceId || null,
            actionType,
            entityType: 'BookData',
            details: {
                status,
                type: req.body ? req.body.type : null,
                return_period: req.body ? req.body.return_period : null,
                mode: context.mode || null,
                key_type: context.keyType || null,
                ...details
            },
            req
        });
    } catch (e) {
        console.error('[logBookActivity] Failed to log activity:', e.message);
    }
};

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
        const context = req.connectorContext || {};
        const { workspaceId, tenantId, mode, keyType } = context;

        const { type, return_period, records } = req.body;

        // ── Validate inputs ────────────────────────────────────────────────
        if (!type || !VALID_TYPES.includes(type)) {
            await logBookActivity(req, 'Failed', 'CONNECTOR_BOOK_IMPORT_INVALID_INPUT', { error: 'type is required or invalid' });
            return errorResponse(res, `type is required. Valid values: ${VALID_TYPES.join(', ')}`, 400);
        }
        if (!records || !Array.isArray(records) || records.length === 0) {
            await logBookActivity(req, 'Failed', 'CONNECTOR_BOOK_IMPORT_INVALID_INPUT', { error: 'records array is required and must not be empty' });
            return errorResponse(res, 'records array is required and must not be empty', 400);
        }
        if (records.length > 5000) {
            await logBookActivity(req, 'Failed', 'CONNECTOR_BOOK_IMPORT_INVALID_INPUT', { error: 'Maximum 5000 records per request exceeded', count: records.length });
            return errorResponse(res, 'Maximum 5000 records per request. Split into multiple batches.', 400);
        }

        // Dynamically resolve return_period if missing (derive MMYYYY format from first record's voucher date)
        let resolvedReturnPeriod = return_period;
        if (!resolvedReturnPeriod && records && records.length > 0) {
            const firstRec = records[0];
            const dateStr = firstRec.vchr_date || firstRec.voucher_date || firstRec.supplier_invoice_date || firstRec.invoice_date;
            if (dateStr && String(dateStr).includes('-')) {
                const parts = String(dateStr).split('-');
                if (parts.length >= 2) {
                    const year = parts[0].length === 4 ? parts[0] : parts[2];
                    const month = parts[1];
                    if (month && year && month.length === 2 && year.length === 4) {
                        resolvedReturnPeriod = `${month}${year}`;
                    }
                }
            }
        }

        // Final fallback to current period in MMYYYY format if resolving failed
        if (!resolvedReturnPeriod) {
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            resolvedReturnPeriod = `${mm}${yyyy}`;
        }

        const bookType    = TYPE_TO_BOOK[type];
        const importType  = TYPE_TO_IMPORT_TYPE[type];
        const isSales     = bookType === 'SALES' || bookType === 'SALES_RETURN';

        // ── Map incoming JSON → BookModel format ───────────────────────────
        const documents = records.map(record =>
            isSales
                ? mapSalesRecord(record, tenantId, workspaceId, resolvedReturnPeriod)
                : mapPurchaseRecord(record, tenantId, workspaceId, resolvedReturnPeriod)
        );

        // ── Create import tracking record ──────────────────────────────
        const importRecord = await ConnectorImportModel.createImportRecord({
            tenantUuid:   tenantId,
            workspaceId,
            returnPeriod: resolvedReturnPeriod,
            financialYear: TaxPeriodService.calculateFinancialYear(resolvedReturnPeriod),
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
            await logBookActivity(req, 'Failed', 'CONNECTOR_BOOK_IMPORT_EMPTY_RESULT', { error: 'No valid records found in payload', records_received: records.length, import_id: importRecord.import_filing_id });
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
        await logBookActivity(req, 'Success', `CONNECTOR_${bookType}_IMPORT`, {
            records_received: records.length,
            records_inserted: result.inserted,
            records_skipped:  result.duplicateInvoices.length,
            import_id:        importRecord.import_filing_id
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
        await logBookActivity(req, 'Failed', 'CONNECTOR_BOOK_IMPORT_ERROR', { error: error.message });
        return errorResponse(res, error.message, 500);
    }
};

module.exports = { importBookData };
