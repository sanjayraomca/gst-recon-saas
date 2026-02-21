const db = require('../../../shared/src/db/connection');

/**
 * Model for Book Data operations (Sales & Purchase)
 */
class BookModel {
    /**
     * Bulk insert Sales Invoices and their items
     * @param {Array} invoices - Array of processed sales invoices { header, items }
     */
    static async bulkInsertSales(invoices) {
        if (!invoices || invoices.length === 0) return { inserted: 0 };

        const trx = await db.transaction();
        try {
            let totalInserted = 0;
            for (const inv of invoices) {
                const { header, items } = inv;

                // Insert/Update Header
                const headerRes = await trx.raw(`
                    INSERT INTO sales_invoices (
                        tenant_id, workspace_id, tax_period_id, invoice_type, 
                        invoice_number, invoice_date, book_type, customer_name, customer_gstin,
                        place_of_supply, reverse_charge, total_taxable_value, 
                        total_igst, total_cgst, total_sgst, total_cess,
                        total_invoice_value, filing_period, payment_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')
                    ON CONFLICT (tenant_id, workspace_id, book_type, invoice_number, tax_period_id) 
                    DO UPDATE SET 
                        total_invoice_value = EXCLUDED.total_invoice_value,
                        total_taxable_value = EXCLUDED.total_taxable_value,
                        total_igst = EXCLUDED.total_igst,
                        total_cgst = EXCLUDED.total_cgst,
                        total_sgst = EXCLUDED.total_sgst,
                        total_cess = EXCLUDED.total_cess,
                        updated_at = NOW()
                    RETURNING id
                `, [
                    header.tenant_id, header.workspace_id, header.tax_period_id, header.invoice_type,
                    header.invoice_number, header.invoice_date, header.book_type, header.customer_name, header.customer_gstin,
                    header.place_of_supply, header.reverse_charge, header.total_taxable_value,
                    header.total_igst, header.total_cgst, header.total_sgst, header.total_cess,
                    header.total_invoice_value, header.filing_period
                ]);

                const invoiceId = headerRes.rows[0].id;

                // Full Replace Strategy for Items
                await trx('sales_invoice_items').where('invoice_id', invoiceId).del();

                if (items && items.length > 0) {
                    const itemsToInsert = items.map((item, idx) => ({
                        invoice_id: invoiceId,
                        line_number: idx + 1,
                        hsn_sac_code: item.hsn_sac_code,
                        description: item.description,
                        quantity: item.quantity,
                        uom: item.uom,
                        unit_rate: item.unit_rate,
                        taxable_value: item.taxable_value,
                        igst_amount: item.igst_amount,
                        cgst_amount: item.cgst_amount,
                        sgst_amount: item.sgst_amount,
                        cess_amount: item.cess_amount,
                        total_amount_with_tax: item.total_amount_with_tax
                    }));
                    await trx.batchInsert('sales_invoice_items', itemsToInsert, 200);
                }
                totalInserted++;
            }
            await trx.commit();
            return { inserted: totalInserted };
        } catch (error) {
            await trx.rollback();
            console.error('[BookModel] Error in bulkInsertSales:', error);
            throw error;
        }
    }

    /**
     * Bulk insert Purchase (Expense Vouchers) and their items
     * @param {Array} vouchers - Array of processed vouchers { header, items }
     */
    static async bulkInsertPurchase(vouchers) {
        if (!vouchers || vouchers.length === 0) return { inserted: 0 };

        const trx = await db.transaction();
        try {
            let totalInserted = 0;
            for (const v of vouchers) {
                const { header, items } = v;

                // Insert/Update Header
                // Inconsistency note: init-gst.sql doesn't show a unique constraint for expense_vouchers
                // We'll use a standard insert and handle it as a new record for now, or use a heuristic.
                // However, to keep it "same as GSTR-2B", a constraint would be ideal.

                const headerRes = await trx.raw(`
                    INSERT INTO expense_vouchers (
                        tenant_id, workspace_id, tax_period_id, voucher_type, book_type,
                        supplier_invoice_no, supplier_invoice_date, supplier_name, supplier_gstin,
                        place_of_supply, round_off, total_qty, discount,
                        taxable_total, net_amount,
                        total_cgst_amount, total_sgst_amount, total_igst_amount, total_cess_amount,
                        itc_eligible, itc_claimed, filing_period, payment_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')
                    ON CONFLICT (tenant_id, workspace_id, book_type, supplier_invoice_no, tax_period_id)
                    DO UPDATE SET
                        voucher_type = EXCLUDED.voucher_type,
                        supplier_name = EXCLUDED.supplier_name,
                        supplier_gstin = EXCLUDED.supplier_gstin,
                        place_of_supply = EXCLUDED.place_of_supply,
                        round_off = EXCLUDED.round_off,
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
                    RETURNING id
                 `, [
                    header.tenant_id, header.workspace_id, header.tax_period_id, header.voucher_type, header.book_type || 'SR',
                    header.supplier_invoice_no, header.supplier_invoice_date, header.supplier_name, header.supplier_gstin,
                    header.place_of_supply, header.round_off || 0, header.total_qty || 0, header.discount || 0,
                    header.taxable_total, header.net_amount,
                    header.total_cgst_amount, header.total_sgst_amount, header.total_igst_amount, header.total_cess_amount,
                    header.itc_eligible, header.itc_claimed, header.filing_period
                ]);

                const voucherId = headerRes.rows[0].id;

                // Replace Strategy for Items
                await trx('expense_items').where('expense_id', voucherId).del();

                if (items && items.length > 0) {
                    const itemsToInsert = items.map(item => ({
                        expense_id: voucherId,
                        hsn_code: item.hsn_code,
                        description: item.description,
                        quantity: item.quantity,
                        uom: item.uom,
                        unit_rate: item.unit_rate,
                        taxable_amount: item.taxable_amount,
                        igst_amount: item.igst_amount,
                        cgst_amount: item.cgst_amount,
                        sgst_amount: item.sgst_amount,
                        cess_amount: item.cess_amount,
                        total_amount_with_tax: item.total_amount_with_tax
                    }));
                    await trx.batchInsert('expense_items', itemsToInsert, 200);
                }
                totalInserted++;
            }
            await trx.commit();
            return { inserted: totalInserted };
        } catch (error) {
            await trx.rollback();
            console.error('[BookModel] Error in bulkInsertPurchase:', error);
            throw error;
        }
    }
}

module.exports = BookModel;
