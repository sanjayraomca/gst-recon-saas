const db = require('../../../shared/src/db/connection');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');
const GstinMasterService = require('../../../shared/src/services/gstinMasterService');
const SupplierMasterService = require('../../../shared/src/services/supplierMasterService');
const CustomerMasterService = require('../../../shared/src/services/customerMasterService');

/**
 * ConnectorImportModel
 *
 * Self-contained version of the import DB logic for the workspace-service container.
 * Replicates the exact same SQL as BookModel and GSTRImportModel in upload-service,
 * but lives entirely within workspace-service so it has no cross-container dependency.
 *
 * Any changes to the SQL in upload-service/src/models/bookModel.js should be
 * mirrored here to keep them in sync.
 */

class ConnectorImportModel {

    // ─────────────────────────────────────────────────────────────────────────
    // Import Tracking (mirrors GSTRImportModel.createImportRecord)
    // ─────────────────────────────────────────────────────────────────────────

    static async createImportRecord({ tenantUuid, workspaceId, returnPeriod, financialYear,
        importType, extraInfo = {}, userEmail, originalFilename }) {
        // Use provided filename, or fall back to a descriptor
        const filename = originalFilename || `api_connector_${importType}_${returnPeriod}`;
        const result = await db.raw(`
            INSERT INTO gstr_import_master (
                tenant_uuid, workspace_id, gstin_recipient, return_period, financial_year,
                generation_date, import_type, original_filename, uploaded_filepath,
                uploaded_file_url, extra_info, imported_by, user_email, status, total_record, file_hash
            ) VALUES (?, ?, 'SELF', ?, ?, NOW(), ?, ?, NULL, NULL, ?, NULL, ?, 'Pending', 0, NULL)
            RETURNING *
        `, [
            tenantUuid, workspaceId, returnPeriod, financialYear,
            importType,
            filename,
            JSON.stringify(extraInfo),
            userEmail || 'connector@api'
        ]);
        return result.rows[0];
    }


    static async updateImportStatus(importFilingId, status, totalRecord = null, extraInfo = null) {
        let query = `UPDATE gstr_import_master SET status = ?`;
        const values = [status];
        if (totalRecord !== null) { query += `, total_record = ?`; values.push(totalRecord); }
        if (extraInfo !== null)   { query += `, extra_info = ?`;   values.push(JSON.stringify(extraInfo)); }
        if (['Completed', 'PartiallyCompleted', 'Failed'].includes(status)) {
            query += `, completed_at = NOW()`;
        }
        query += ` WHERE import_filing_id = ? RETURNING *`;
        values.push(importFilingId);
        const result = await db.raw(query, values);
        return result.rows[0];
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Purchase Vouchers (mirrors BookModel.bulkInsertPurchase)
    // ─────────────────────────────────────────────────────────────────────────

    static async bulkInsertPurchase(vouchers) {
        if (!vouchers || vouchers.length === 0)
            return { inserted: 0, addedInvoices: [], duplicateInvoices: [] };

        const trx = await db.transaction();
        try {
            let totalProcessed = 0, totalInserted = 0;
            const addedInvoices = [], duplicateInvoices = [];

            for (const v of vouchers) {
                const { header, items } = v;
                const spName = `cv_${totalProcessed++}`;
                await trx.raw(`SAVEPOINT ${spName}`);

                try {
                    // Resolve tax period
                    const rowTaxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(header.filing_period, trx);
                    if (rowTaxPeriodId) header.tax_period_id = rowTaxPeriodId;

                    // SMART CAPTURE: ensure supplier GSTIN in master
                    if (header.supplier_gstin) {
                        const cleanGstin = header.supplier_gstin.trim().toUpperCase();
                        if (cleanGstin.length === 15) {
                            await GstinMasterService.ensureGstin(cleanGstin, { legal_name: header.supplier_name }, trx);
                            header.supplier_gstin = cleanGstin;
                        } else {
                            header.supplier_gstin = null;
                        }
                    }
                    if (header.supplier_gstin || header.supplier_name) {
                        await SupplierMasterService.upsertSupplier(header.workspace_id, header.supplier_gstin, header.supplier_name, trx);
                    }

                    const headerRes = await trx.raw(`
                        INSERT INTO purchase_vouchers (
                            tenant_id, workspace_id, tax_period_id, voucher_type, book_type,
                            book_vchr_no, book_vchr_date,
                            supplier_invoice_no, supplier_invoice_date, supplier_name, supplier_gstin,
                            place_of_supply, is_interstate, is_rcm, round_off, status, remarks,
                            total_qty, discount, taxable_total, net_amount,
                            total_cgst_amount, total_sgst_amount, total_igst_amount, total_cess_amount,
                            itc_eligible, itc_claimed, filing_period, return_period, payment_status,
                            is_amendment, original_supplier_invoice_no, original_supplier_invoice_date,
                            original_book_vchr_no, original_book_vchr_date, original_net_amount,
                            return_date, original_return_period, original_return_date, source_section,
                            gstr_category, t_extra_info
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (tenant_id, workspace_id, book_type, tax_period_id, book_vchr_no)
                        DO UPDATE SET
                            book_vchr_no = EXCLUDED.book_vchr_no,
                            book_vchr_date = EXCLUDED.book_vchr_date,
                            voucher_type = EXCLUDED.voucher_type,
                            supplier_name = EXCLUDED.supplier_name,
                            supplier_gstin = EXCLUDED.supplier_gstin,
                            place_of_supply = EXCLUDED.place_of_supply,
                            is_interstate = EXCLUDED.is_interstate,
                            is_rcm = EXCLUDED.is_rcm,
                            round_off = EXCLUDED.round_off,
                            status = EXCLUDED.status,
                            remarks = EXCLUDED.remarks,
                            total_qty = EXCLUDED.total_qty,
                            discount = EXCLUDED.discount,
                            taxable_total = EXCLUDED.taxable_total,
                            net_amount = EXCLUDED.net_amount,
                            total_cgst_amount = EXCLUDED.total_cgst_amount,
                            total_sgst_amount = EXCLUDED.total_sgst_amount,
                            total_igst_amount = EXCLUDED.total_igst_amount,
                            total_cess_amount = EXCLUDED.total_cess_amount,
                            itc_eligible = EXCLUDED.itc_eligible,
                            return_period = EXCLUDED.return_period,
                            is_amendment = EXCLUDED.is_amendment,
                            original_supplier_invoice_no = EXCLUDED.original_supplier_invoice_no,
                            original_supplier_invoice_date = EXCLUDED.original_supplier_invoice_date,
                            original_book_vchr_no = EXCLUDED.original_book_vchr_no,
                            original_book_vchr_date = EXCLUDED.original_book_vchr_date,
                            original_net_amount = EXCLUDED.original_net_amount,
                            return_date = EXCLUDED.return_date,
                            original_return_period = EXCLUDED.original_return_period,
                            original_return_date = EXCLUDED.original_return_date,
                            gstr_category = EXCLUDED.gstr_category,
                            t_extra_info = EXCLUDED.t_extra_info,
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS is_inserted
                    `, [
                        header.tenant_id, header.workspace_id, header.tax_period_id || null,
                        header.voucher_type || null, header.book_type || 'PR',
                        header.book_vchr_no || null, header.book_vchr_date || null,
                        String(header.supplier_invoice_no || '').substring(0, 50),
                        header.supplier_invoice_date || null,
                        String(header.supplier_name || '').substring(0, 255),
                        header.supplier_gstin || null,
                        header.place_of_supply || null, header.is_interstate || 'No',
                        header.is_rcm || false, header.round_off || 0,
                        header.status || 'DRAFT', header.remarks || null,
                        header.total_qty || 0, header.discount || 0,
                        header.taxable_total || 0, header.net_amount || 0,
                        header.total_cgst_amount || 0, header.total_sgst_amount || 0,
                        header.total_igst_amount || 0, header.total_cess_amount || 0,
                        header.itc_eligible !== undefined ? header.itc_eligible : null,
                        header.itc_claimed !== undefined ? header.itc_claimed : null,
                        header.filing_period || null, header.return_period || header.filing_period || null,
                        header.is_amendment || false,
                        header.original_supplier_invoice_no || null,
                        header.original_supplier_invoice_date || null,
                        header.original_book_vchr_no || null,
                        header.original_book_vchr_date || null,
                        header.original_net_amount || 0,
                        header.return_date || null,
                        header.original_return_period || null,
                        header.original_return_date || null,
                        header.source_section || null,
                        header.gstr_category || null,
                        JSON.stringify(header.t_extra_info || {})
                    ]);

                    const voucherId = headerRes.rows[0].id;
                    const isInserted = headerRes.rows[0].is_inserted;
                    if (isInserted) { addedInvoices.push(header.book_vchr_no); totalInserted++; }
                    else            { duplicateInvoices.push(header.book_vchr_no); }

                    // Items
                    await trx('purchase_items').where('purchase_id', voucherId).del();
                    if (items && items.length > 0) {
                        const itemsToInsert = items.map(item => ({
                            purchase_id:              voucherId,
                            hsn_code:                 String(item.hsn_code || '').substring(0, 20) || null,
                            description:              item.description || null,
                            quantity:                 item.quantity || 0,
                            uom:                      String(item.uom || '').substring(0, 20) || null,
                            unit_rate:                item.unit_rate || 0,
                            taxable_amount:           item.taxable_amount || 0,
                            tax_per:                  item.tax_per || 0,
                            igst_amount:              item.igst_amount || 0,
                            cgst_amount:              item.cgst_amount || 0,
                            sgst_amount:              item.sgst_amount || 0,
                            cess_amount:              item.cess_amount || 0,
                            total_amount_with_tax:    item.total_amount_with_tax || 0,
                            original_taxable_amount:  item.original_taxable_amount || 0,
                            original_igst_amount:     item.original_igst_amount || 0,
                            original_cgst_amount:     item.original_cgst_amount || 0,
                            original_sgst_amount:     item.original_sgst_amount || 0,
                            original_cess_amount:     item.original_cess_amount || 0,
                            original_tax_per:         item.original_tax_per || 0,
                            t_extra_info:             '{}'
                        }));
                        await trx.batchInsert('purchase_items', itemsToInsert, 999999);
                    }

                    await trx.raw(`RELEASE SAVEPOINT ${spName}`);
                } catch (rowErr) {
                    await trx.raw(`ROLLBACK TO SAVEPOINT ${spName}`);
                    console.warn(`[ConnectorImportModel] Skipped purchase voucher ${header.book_vchr_no}: ${rowErr.message}`);
                }
            }

            await trx.commit();
            return { inserted: totalInserted, addedInvoices, duplicateInvoices };
        } catch (error) {
            await trx.rollback();
            console.error('[ConnectorImportModel.bulkInsertPurchase]', error);
            throw error;
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Sales Invoices (mirrors BookModel.bulkInsertSales)
    // ─────────────────────────────────────────────────────────────────────────

    static async bulkInsertSales(invoices) {
        if (!invoices || invoices.length === 0)
            return { inserted: 0, addedInvoices: [], duplicateInvoices: [] };

        const trx = await db.transaction();
        try {
            let totalProcessed = 0, totalInserted = 0;
            const addedInvoices = [], duplicateInvoices = [];

            for (const inv of invoices) {
                const { header, items } = inv;
                const spName = `cs_${totalProcessed++}`;
                await trx.raw(`SAVEPOINT ${spName}`);

                try {
                    const rowTaxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(header.filing_period, trx);
                    if (rowTaxPeriodId) header.tax_period_id = rowTaxPeriodId;

                    // SMART CAPTURE: customer master
                    if (header.customer_gstin || header.customer_name) {
                        await CustomerMasterService.upsertCustomer(header.workspace_id, header.customer_gstin, header.customer_name, trx);
                    }

                    const headerRes = await trx.raw(`
                        INSERT INTO sales_invoices (
                            tenant_id, workspace_id, tax_period_id, invoice_type,
                            invoice_number, invoice_date, book_type, customer_name, customer_gstin,
                            place_of_supply, reverse_charge, is_amendment, round_off,
                            total_taxable_value, total_igst, total_cgst, total_sgst, total_cess,
                            total_invoice_value, filing_period, return_period, payment_status,
                            original_invoice_no, original_invoice_date, original_book_vchr_no,
                            original_book_vchr_date, original_net_amount, return_date,
                            original_return_period, original_return_date, source_section,
                            gstr_category, t_extra_info
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (tenant_id, workspace_id, book_type, invoice_number, tax_period_id)
                        DO UPDATE SET
                            customer_name = EXCLUDED.customer_name,
                            customer_gstin = EXCLUDED.customer_gstin,
                            total_invoice_value = EXCLUDED.total_invoice_value,
                            total_taxable_value = EXCLUDED.total_taxable_value,
                            total_igst = EXCLUDED.total_igst,
                            total_cgst = EXCLUDED.total_cgst,
                            total_sgst = EXCLUDED.total_sgst,
                            total_cess = EXCLUDED.total_cess,
                            is_amendment = EXCLUDED.is_amendment,
                            round_off = EXCLUDED.round_off,
                            return_period = EXCLUDED.return_period,
                            original_invoice_no = EXCLUDED.original_invoice_no,
                            original_invoice_date = EXCLUDED.original_invoice_date,
                            original_book_vchr_no = EXCLUDED.original_book_vchr_no,
                            original_book_vchr_date = EXCLUDED.original_book_vchr_date,
                            original_net_amount = EXCLUDED.original_net_amount,
                            return_date = EXCLUDED.return_date,
                            original_return_period = EXCLUDED.original_return_period,
                            original_return_date = EXCLUDED.original_return_date,
                            gstr_category = EXCLUDED.gstr_category,
                            t_extra_info = EXCLUDED.t_extra_info,
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS is_inserted
                    `, [
                        header.tenant_id, header.workspace_id, header.tax_period_id || null,
                        header.invoice_type || 'B2B',
                        header.invoice_number, header.invoice_date,
                        header.book_type || 'SA',
                        header.customer_name || null, header.customer_gstin || null,
                        header.place_of_supply || null, header.reverse_charge || false,
                        header.is_amendment || false, header.round_off || 0,
                        header.total_taxable_value || 0,
                        header.total_igst || 0, header.total_cgst || 0,
                        header.total_sgst || 0, header.total_cess || 0,
                        header.total_invoice_value || 0,
                        header.filing_period || null, header.return_period || header.filing_period || null,
                        header.original_invoice_no || null, header.original_invoice_date || null,
                        header.original_book_vchr_no || null, header.original_book_vchr_date || null,
                        header.original_net_amount || 0, header.return_date || null,
                        header.original_return_period || null, header.original_return_date || null,
                        header.source_section || null,
                        header.gstr_category || null,
                        JSON.stringify(header.t_extra_info || {})
                    ]);

                    const invoiceId = headerRes.rows[0].id;
                    const isInserted = headerRes.rows[0].is_inserted;
                    if (isInserted) { addedInvoices.push(header.invoice_number); totalInserted++; }
                    else            { duplicateInvoices.push(header.invoice_number); }

                    // Items
                    await trx('sales_invoice_items').where('invoice_id', invoiceId).del();
                    if (items && items.length > 0) {
                        const itemsToInsert = items.map((item, idx) => ({
                            invoice_id:                 invoiceId,
                            line_number:                idx + 1,
                            hsn_sac_code:               item.hsn_sac_code || null,
                            description:                item.description || null,
                            quantity:                   item.quantity || 0,
                            uom:                        item.uom || null,
                            unit_rate:                  item.unit_rate || 0,
                            taxable_value:              item.taxable_value || 0,
                            gst_rate_percent:           item.gst_rate_percent || 0,
                            igst_amount:                item.igst_amount || 0,
                            cgst_amount:                item.cgst_amount || 0,
                            sgst_amount:                item.sgst_amount || 0,
                            cess_amount:                item.cess_amount || 0,
                            total_amount_with_tax:      item.total_amount_with_tax || 0,
                            original_taxable_value:     item.original_taxable_value || 0,
                            original_igst_amount:       item.original_igst_amount || 0,
                            original_cgst_amount:       item.original_cgst_amount || 0,
                            original_sgst_amount:       item.original_sgst_amount || 0,
                            original_cess_amount:       item.original_cess_amount || 0,
                            original_gst_rate_percent:  item.original_gst_rate_percent || 0,
                            t_extra_info:               '{}'
                        }));
                        await trx.batchInsert('sales_invoice_items', itemsToInsert, 999999);
                    }

                    await trx.raw(`RELEASE SAVEPOINT ${spName}`);
                } catch (rowErr) {
                    await trx.raw(`ROLLBACK TO SAVEPOINT ${spName}`);
                    console.warn(`[ConnectorImportModel] Skipped sales invoice ${header.invoice_number}: ${rowErr.message}`);
                }
            }

            await trx.commit();
            return { inserted: totalInserted, addedInvoices, duplicateInvoices };
        } catch (error) {
            await trx.rollback();
            console.error('[ConnectorImportModel.bulkInsertSales]', error);
            throw error;
        }
    }
}

module.exports = ConnectorImportModel;
