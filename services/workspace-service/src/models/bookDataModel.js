const db = require('../../../shared/src/db/connection');

/**
 * BookDataModel
 * Provides listing queries for all 9 book data types:
 *  - Sales: sales_invoices (invoice_type: B2B, B2C_SMALL, B2C_LARGE, CREDIT_NOTE, DEBIT_NOTE, EXPORT, SEZ)
 *  - Purchase/Expense: expense_vouchers (book_type: SR, CN, DN; voucher_type: PURCHASE, EXPENSE, CREDIT_NOTE, DEBIT_NOTE)
 */
class BookDataModel {

    /**
     * Map a bookTypeId (from frontend) to DB query params
     * Returns { table, filters }
     */
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

    /**
     * Get paginated book data records for a given type.
     */
    static async getByType(workspaceId, bookTypeId, filters = {}, pagination = {}) {
        const resolved = BookDataModel._resolveType(bookTypeId);
        if (!resolved) throw new Error(`Unknown book type: ${bookTypeId}`);

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;
        const { search, status, period } = filters;

        let records = [];
        let total = 0;

        if (resolved.table === 'sales') {
            let q = db('sales_invoices as si')
                .where('si.workspace_id', workspaceId);

            if (resolved.invoiceTypes) {
                q = q.whereIn('si.invoice_type', resolved.invoiceTypes);
            }
            if (resolved.bookTypes) {
                // sales_invoices doesn't have book_type col; SR means invoice_type B2B/B2C where it's a return
                // We use invoice_type CREDIT_NOTE for CN, so for SR just use the invoice type filter
                q = q.whereIn('si.invoice_type', ['B2B', 'B2C_SMALL']);
            }
            if (period) {
                // period format: YYYY-MM
                const [yr, mo] = period.split('-');
                if (yr && mo) {
                    q = q.whereRaw(`to_char(si.invoice_date, 'YYYY-MM') = ?`, [`${yr}-${mo}`]);
                }
            }
            if (search) {
                q = q.where(function () {
                    this.where('si.invoice_number', 'ilike', `%${search}%`)
                        .orWhere('si.customer_name', 'ilike', `%${search}%`)
                        .orWhere('si.customer_gstin', 'ilike', `%${search}%`);
                });
            }
            if (status && status !== 'all') q = q.where('si.status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            records = await q
                .select(
                    'si.id',
                    'si.invoice_number as invoiceNo',
                    db.raw("to_char(si.invoice_date, 'YYYY-MM-DD') as date"),
                    'si.customer_name as party',
                    'si.customer_gstin as gstin',
                    'si.total_taxable_value as taxableAmt',
                    'si.total_cgst as cgst',
                    'si.total_sgst as sgst',
                    'si.total_igst as igst',
                    'si.total_cess as cess',
                    'si.total_invoice_value as totalAmt',
                    'si.place_of_supply as placeOfSupply',
                    db.raw("CASE WHEN si.is_interstate THEN 'Yes' ELSE 'No' END as \"isInterstate\""),
                    'si.status',
                    'si.invoice_type as docType'
                )
                .orderBy('si.invoice_date', 'desc')
                .limit(page_size)
                .offset(offset);

        } else {
            // expense_vouchers
            let q = db('expense_vouchers as ev')
                .where('ev.workspace_id', workspaceId);

            if (resolved.voucherTypes) q = q.whereIn('ev.voucher_type', resolved.voucherTypes);
            if (resolved.bookTypes) q = q.whereIn('ev.book_type', resolved.bookTypes);

            if (period) {
                const [yr, mo] = period.split('-');
                if (yr && mo) {
                    q = q.whereRaw(`to_char(ev.supplier_invoice_date, 'YYYY-MM') = ?`, [`${yr}-${mo}`]);
                }
            }
            if (search) {
                q = q.where(function () {
                    this.where('ev.supplier_invoice_no', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_gstin', 'ilike', `%${search}%`);
                });
            }
            if (status && status !== 'all') q = q.where('ev.status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            records = await q
                .select(
                    'ev.id',
                    'ev.supplier_invoice_no as invoiceNo',
                    db.raw("to_char(ev.supplier_invoice_date, 'YYYY-MM-DD') as date"),
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
                total_pages: Math.ceil(total / page_size)
            }
        };
    }
}

module.exports = BookDataModel;
