const db = require('../../../shared/src/db/connection');

/**
 * BookDataModel
 * Provides listing queries for all 9 book data types.
 * Column names validated against actual DB schema (2026-02-24).
 *
 * sales_invoices columns used:
 *   id, workspace_id, invoice_type, book_type, invoice_number, invoice_date,
 *   customer_name, customer_gstin, place_of_supply, is_interstate,
 *   total_taxable_value, total_igst, total_cgst, total_sgst, total_cess,
 *   total_invoice_value, filing_status (NO plain 'status' column)
 *
 * expense_vouchers columns used:
 *   id, workspace_id, voucher_type, book_type, supplier_invoice_no,
 *   supplier_invoice_date, supplier_name, supplier_gstin, place_of_supply,
 *   is_interstate, taxable_total, total_cgst_amount, total_sgst_amount,
 *   total_igst_amount, total_cess_amount, net_amount, status, filing_status
 */
class BookDataModel {

    static _resolveType(bookTypeId) {
        switch (bookTypeId) {
            case 'sales_invoice':
                return { table: 'sales', invoiceTypes: ['B2B', 'B2C_SMALL', 'B2C_LARGE', 'EXPORT', 'SEZ'] };
            case 'sales_return':
                return { table: 'sales', bookTypes: ['SR'] };
            case 'cn_sales':
                return { table: 'sales', invoiceTypes: ['CREDIT_NOTE'] };
            case 'dn_sales':
                return { table: 'sales', invoiceTypes: ['DEBIT_NOTE'] };
            case 'purchase_invoice':
                return { table: 'expense', voucherTypes: ['PURCHASE'] };
            case 'expense_invoice':
                return { table: 'expense', voucherTypes: ['EXPENSE'] };
            case 'purchase_return':
                return { table: 'expense', bookTypes: ['DN'], voucherTypes: ['PURCHASE'] };
            case 'cn_purchase':
                return { table: 'expense', voucherTypes: ['CREDIT_NOTE'], bookTypes: ['CN'] };
            case 'dn_purchase':
                return { table: 'expense', voucherTypes: ['DEBIT_NOTE'], bookTypes: ['DN'] };
            default:
                return null;
        }
    }

    static async getByType(workspaceId, bookTypeId, filters = {}, pagination = {}) {
        const resolved = BookDataModel._resolveType(bookTypeId);
        if (!resolved) throw new Error(`Unknown book type: ${bookTypeId}`);

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;
        const { search, status, period } = filters;

        let records = [];
        let total = 0;

        if (resolved.table === 'sales') {
            // --- sales_invoices ---
            let q = db('sales_invoices as si')
                .where('si.workspace_id', workspaceId);

            if (resolved.invoiceTypes) q = q.whereIn('si.invoice_type', resolved.invoiceTypes);
            if (resolved.bookTypes) q = q.whereIn('si.book_type', resolved.bookTypes);

            if (period) {
                const [yr, mo] = period.split('-');
                if (yr && mo) q = q.whereRaw(`to_char(si.invoice_date, 'YYYY-MM') = ?`, [`${yr}-${mo}`]);
            }
            if (search) {
                q = q.where(function () {
                    this.where('si.invoice_number', 'ilike', `%${search}%`)
                        .orWhere('si.customer_name', 'ilike', `%${search}%`)
                        .orWhere('si.customer_gstin', 'ilike', `%${search}%`);
                });
            }
            // sales_invoices has filing_status, not status
            if (status && status !== 'all') q = q.where('si.filing_status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            records = await q
                .select(
                    'si.id',
                    'si.invoice_number as invoiceNo',
                    db.raw("to_char(si.invoice_date, 'DD-MM-YYYY') as date"),
                    'si.customer_name as party',
                    db.raw("trim(si.customer_gstin) as gstin"),
                    'si.total_taxable_value as taxableAmt',
                    'si.total_cgst as cgst',
                    'si.total_sgst as sgst',
                    'si.total_igst as igst',
                    'si.total_cess as cess',
                    'si.total_invoice_value as totalAmt',
                    'si.place_of_supply as placeOfSupply',
                    db.raw("CASE WHEN si.is_interstate THEN 'Yes' ELSE 'No' END as \"isInterstate\""),
                    'si.filing_status as status',
                    'si.invoice_type as docType'
                )
                .orderBy('si.invoice_date', 'desc')
                .limit(page_size)
                .offset(offset);

        } else {
            // --- expense_vouchers ---
            let q = db('expense_vouchers as ev')
                .where('ev.workspace_id', workspaceId);

            if (resolved.voucherTypes) q = q.whereIn('ev.voucher_type', resolved.voucherTypes);
            if (resolved.bookTypes) q = q.whereIn('ev.book_type', resolved.bookTypes);

            if (period) {
                const [yr, mo] = period.split('-');
                if (yr && mo) q = q.whereRaw(`to_char(ev.supplier_invoice_date, 'YYYY-MM') = ?`, [`${yr}-${mo}`]);
            }
            if (search) {
                q = q.where(function () {
                    this.where('ev.supplier_invoice_no', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_gstin', 'ilike', `%${search}%`);
                });
            }
            // expense_vouchers has a plain 'status' column
            if (status && status !== 'all') q = q.where('ev.status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            records = await q
                .select(
                    'ev.id',
                    'ev.supplier_invoice_no as invoiceNo',
                    db.raw("to_char(ev.supplier_invoice_date, 'DD-MM-YYYY') as date"),
                    'ev.supplier_name as party',
                    'ev.supplier_gstin as gstin',
                    'ev.taxable_total as taxableAmt',
                    'ev.total_cgst_amount as cgst',
                    'ev.total_sgst_amount as sgst',
                    'ev.total_igst_amount as igst',
                    'ev.total_cess_amount as cess',
                    'ev.net_amount as totalAmt',
                    'ev.place_of_supply as placeOfSupply',
                    'ev.is_interstate as isInterstate',
                    'ev.status',
                    'ev.book_type as docType'
                )
                .orderBy('ev.supplier_invoice_date', 'desc')
                .limit(page_size)
                .offset(offset);
        }

        return {
            data: records,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total,
                total_pages: Math.ceil(total / page_size) || 1
            }
        };
    }
}

module.exports = BookDataModel;
