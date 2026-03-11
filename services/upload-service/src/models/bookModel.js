const db = require('../../../shared/src/db/connection');
const GstinMasterService = require('../../../shared/src/services/gstinMasterService');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');


/**
 * Model for Book Data operations (Sales & Purchase)
 */
class BookModel {
    /**
     * Bulk insert Sales Invoices and their items
     * @param {Array} invoices - Array of processed sales invoices { header, items }
     */
    static async bulkInsertSales(invoices) {
        if (!invoices || invoices.length === 0) return { inserted: 0, addedInvoices: [], duplicateInvoices: [] };

        const trx = await db.transaction();
        try {
            let totalProcessed = 0;
            let totalInserted = 0;
            const addedInvoices = [];
            const duplicateInvoices = [];
            
            for (const inv of invoices) {
                const { header, items } = inv;
                const spName = `sales_${totalProcessed++}`;

                await trx.raw(`SAVEPOINT ${spName}`);
                try {
                    // RESOLVE TAX PERIOD DYNAMICALLY
                    const rowTaxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(header.filing_period, trx);
                    if (rowTaxPeriodId) {
                        header.tax_period_id = rowTaxPeriodId;
                    }

                    // Insert/Update Header
                    // Using xmax to determine if row was inserted (0) or updated (>0)
                    const headerRes = await trx.raw(`
                        INSERT INTO sales_invoices (
                            tenant_id, workspace_id, tax_period_id, invoice_type, 
                            invoice_number, invoice_date, book_type, customer_name, customer_gstin,
                            place_of_supply, reverse_charge, is_amendment, round_off, total_taxable_value, 
                            total_igst, total_cgst, total_sgst, total_cess,
                            total_invoice_value, filing_period, payment_status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')
                        ON CONFLICT (tenant_id, workspace_id, book_type, invoice_number, tax_period_id) 
                        DO UPDATE SET 
                            total_invoice_value = EXCLUDED.total_invoice_value,
                            total_taxable_value = EXCLUDED.total_taxable_value,
                            total_igst = EXCLUDED.total_igst,
                            total_cgst = EXCLUDED.total_cgst,
                            total_sgst = EXCLUDED.total_sgst,
                            total_cess = EXCLUDED.total_cess,
                            is_amendment = EXCLUDED.is_amendment,
                            round_off = EXCLUDED.round_off,
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS is_inserted
                    `, [
                        header.tenant_id, header.workspace_id, header.tax_period_id || null, header.invoice_type,
                        header.invoice_number, header.invoice_date, header.book_type || 'SA', header.customer_name || null, header.customer_gstin || null,
                        header.place_of_supply || null, header.reverse_charge || false, header.is_amendment || false, header.round_off || 0, header.total_taxable_value || 0,
                        header.total_igst || 0, header.total_cgst || 0, header.total_sgst || 0, header.total_cess || 0,
                        header.total_invoice_value || 0, header.filing_period || null
                    ]);

                    const invoiceId = headerRes.rows[0].id;
                    const isInserted = headerRes.rows[0].is_inserted;

                    if (isInserted) {
                        addedInvoices.push(header.invoice_number);
                        totalInserted++; // Only increment for truly new inserts
                    } else {
                        duplicateInvoices.push(header.invoice_number);
                    }

                    // Full Replace Strategy for Items
                    await trx('sales_invoice_items').where('invoice_id', invoiceId).del();

                    if (items && items.length > 0) {
                        const itemsToInsert = items.map((item, idx) => ({
                            invoice_id: invoiceId,
                            line_number: idx + 1,
                            hsn_sac_code: item.hsn_sac_code || null,
                            description: item.description || null,
                            quantity: item.quantity || 0,
                            uom: item.uom || null,
                            unit_rate: item.unit_rate || 0,
                            taxable_value: item.taxable_value || 0,
                            gst_rate_percent: item.gst_rate_percent || 0,
                            igst_amount: item.igst_amount || 0,
                            cgst_amount: item.cgst_amount || 0,
                            sgst_amount: item.sgst_amount || 0,
                            cess_amount: item.cess_amount || 0,
                            total_amount_with_tax: item.total_amount_with_tax || 0
                        }));
                        await trx.batchInsert('sales_invoice_items', itemsToInsert, 200);
                    }
                    
                    await trx.raw(`RELEASE SAVEPOINT ${spName}`);
                    
                } catch (rowErr) {
                    await trx.raw(`ROLLBACK TO SAVEPOINT ${spName}`);
                    console.warn(`[BookModel] Skipped sales invoice ${header.invoice_number} due to error: ${rowErr.message}`);
                }
            }
            await trx.commit();
            return { inserted: totalInserted, addedInvoices, duplicateInvoices };
        } catch (error) {
            await trx.rollback();
            console.error('[BookModel] Error in bulkInsertSales:', error);
            throw error;
        }
    }

    /**
     * Bulk insert Purchase (Purchase Vouchers) and their items
     * @param {Array} vouchers - Array of processed vouchers { header, items }
     */
    static async bulkInsertPurchase(vouchers) {
        if (!vouchers || vouchers.length === 0) return { inserted: 0, addedInvoices: [], duplicateInvoices: [] };

        const trx = await db.transaction();
        try {
            let totalProcessed = 0;
            let totalInserted = 0;
            const addedInvoices = [];
            const duplicateInvoices = [];

            for (const v of vouchers) {
                const { header, items } = v;
                const spName = `voucher_${totalProcessed++}`;

                await trx.raw(`SAVEPOINT ${spName}`);
                try {
                    // RESOLVE TAX PERIOD DYNAMICALLY
                    const rowTaxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(header.filing_period, trx);
                    if (rowTaxPeriodId) {
                        header.tax_period_id = rowTaxPeriodId;
                    }

                    // Ensure supplier GSTIN exists in gstin_master (via shared reusable service)
                    if (header.supplier_gstin) {

                        const cleanGstin = header.supplier_gstin.trim().toUpperCase();
                        if (cleanGstin.length === 15) {
                            await GstinMasterService.ensureGstin(
                                cleanGstin,
                                { legal_name: header.supplier_name },
                                trx
                            );
                            header.supplier_gstin = cleanGstin;
                        } else {
                            // Invalid GSTIN length; do not hit DB to avoid value too long errors
                            header.supplier_gstin = null;
                        }
                    }

                    const headerRes = await trx.raw(`
                        INSERT INTO purchase_vouchers (
                            tenant_id, workspace_id, tax_period_id, voucher_type, book_type,
                            supplier_invoice_no, supplier_invoice_date, supplier_name, supplier_gstin,
                            place_of_supply, is_interstate, is_rcm, round_off, status, remarks, 
                            total_qty, discount,
                            taxable_total, net_amount,
                            total_cgst_amount, total_sgst_amount, total_igst_amount, total_cess_amount,
                            itc_eligible, itc_claimed, filing_period, payment_status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')
                        ON CONFLICT (tenant_id, workspace_id, book_type, supplier_invoice_no, tax_period_id)
                        DO UPDATE SET
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
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS is_inserted
                     `, [
                        header.tenant_id, header.workspace_id, header.tax_period_id || null, header.voucher_type || null, header.book_type || 'SR',
                        String(header.supplier_invoice_no || '').substring(0, 50), header.supplier_invoice_date || null, String(header.supplier_name || '').substring(0, 255), header.supplier_gstin || null,
                        header.place_of_supply || null, header.is_interstate || 'No', header.is_rcm || false, header.round_off || 0,
                        header.status || 'DRAFT', header.remarks || null,
                        header.total_qty || 0, header.discount || 0,
                        header.taxable_total || 0, header.net_amount || 0,
                        header.total_cgst_amount || 0, header.total_sgst_amount || 0, header.total_igst_amount || 0, header.total_cess_amount || 0,
                        header.itc_eligible !== undefined ? header.itc_eligible : null, header.itc_claimed !== undefined ? header.itc_claimed : null, header.filing_period || null
                    ]);

                    const voucherId = headerRes.rows[0].id;
                    const isInserted = headerRes.rows[0].is_inserted;

                    if (isInserted) {
                        addedInvoices.push(header.supplier_invoice_no);
                        totalInserted++; // Only increment for truly new inserts
                    } else {
                        duplicateInvoices.push(header.supplier_invoice_no);
                    }

                    // Replace Strategy for Items
                    await trx('purchase_items').where('purchase_id', voucherId).del();

                    if (items && items.length > 0) {
                        const itemsToInsert = items.map(item => ({
                            purchase_id: voucherId,
                            hsn_code: String(item.hsn_code || '').substring(0, 20) || null,
                            description: item.description || null,
                            quantity: item.quantity || 0,
                            uom: String(item.uom || '').substring(0, 20) || null,
                            unit_rate: item.unit_rate || 0,
                            taxable_amount: item.taxable_amount || 0,
                            tax_per: item.tax_per || 0,
                            igst_amount: item.igst_amount || 0,
                            cgst_amount: item.cgst_amount || 0,
                            sgst_amount: item.sgst_amount || 0,
                            cess_amount: item.cess_amount || 0,
                            total_amount_with_tax: item.total_amount_with_tax || 0
                        }));
                        await trx.batchInsert('purchase_items', itemsToInsert, 200);
                    }
                    
                    await trx.raw(`RELEASE SAVEPOINT ${spName}`);
                } catch (rowErr) {
                    await trx.raw(`ROLLBACK TO SAVEPOINT ${spName}`);
                    console.warn(`[BookModel] Skipped voucher ${header.supplier_invoice_no} due to error: ${rowErr.message}`);
                }
            }
            await trx.commit();
            return { inserted: totalInserted, addedInvoices, duplicateInvoices };
        } catch (error) {
            await trx.rollback();
            console.error('[BookModel] Error in bulkInsertPurchase:', error);
            throw error;
        }
    }
}

module.exports = BookModel;
