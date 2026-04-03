const knex = require('../../../shared/src/db/connection');

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
 * purchase_vouchers columns used:
 *   id, workspace_id, voucher_type, book_type, supplier_invoice_no,
 *   supplier_invoice_date, supplier_name, supplier_gstin, place_of_supply,
 *   is_interstate, taxable_total, total_cgst_amount, total_sgst_amount,
 *   total_igst_amount, total_cess_amount, net_amount, status, filing_status
 */
class BookDataModel {

    static _resolveType(bookTypeId) {
        switch (bookTypeId) {
            case 'sales_invoice':
            case 'SALES_REGISTER':
                return { table: 'sales', invoiceTypes: ['B2B', 'B2C_SMALL', 'B2C_LARGE', 'EXPORT', 'SEZ'] };
            case 'SALES_UPLOAD':
                return { table: 'sales' }; // Includes all: SA, SR, CN, DN
            case 'sales_return':
                return { table: 'sales', bookTypes: ['SR'] };
            case 'cn_sales':
                return { table: 'sales', invoiceTypes: ['CREDIT_NOTE'] };
            case 'dn_sales':
                return { table: 'sales', invoiceTypes: ['DEBIT_NOTE'] };
            case 'purchase_invoice':
            case 'PURCHASE_REGISTER':
                return { table: 'purchase', voucherTypes: ['PURCHASE'] };
            case 'PURCHASE_UPLOAD':
                return { table: 'purchase' }; // Includes all: PA, EXP, CN, DN
            case 'expense_invoice':
                return { table: 'purchase', voucherTypes: ['EXPENSE'] };
            case 'purchase_return':
                return { table: 'purchase', bookTypes: ['DN'], voucherTypes: ['PURCHASE'] };
            case 'cn_purchase':
                return { table: 'purchase', voucherTypes: ['CREDIT_NOTE'], bookTypes: ['CN'] };
            case 'dn_purchase':
                return { table: 'purchase', voucherTypes: ['DEBIT_NOTE'], bookTypes: ['DN'] };
            default:
                return null;
        }
    }

    /**
     * _addPeriodFilter - Helper to apply period filtering to a knex query.
     * Supports YYYY-MM and YYYY-QX formats.
     */
    static _addPeriodFilter(q, period, dateCol) {
        if (!period || period === 'ALL') return q;

        // quarterly format: 2017-Q1 or Q1-2017 or Q12017
        if (period.includes('Q') || period.startsWith('Q')) {
            let qNum, yr;
            if (period.includes('-')) {
                const parts = period.split('-');
                if (parts[0].startsWith('Q')) {
                    qNum = parseInt(parts[0].substring(1));
                    yr = parts[1];
                } else {
                    yr = parts[0];
                    qNum = parseInt(parts[1].substring(1));
                }
            } else {
                // e.g. Q12017
                qNum = parseInt(period.substring(1, 2));
                yr = period.substring(2);
            }

            if (isNaN(qNum) || !yr) return q;

            let months = [];
            if (qNum === 1) months = ['04', '05', '06'];
            else if (qNum === 2) months = ['07', '08', '09'];
            else if (qNum === 3) months = ['10', '11', '12'];
            else if (qNum === 4) months = ['01', '02', '03'];

            const conditions = months.map(mo => `${yr}-${mo}`);
            return q.whereRaw(`to_char(${dateCol}, 'YYYY-MM') = ANY(?)`, [conditions]);
        }

        // monthly format: YYYY-MM
        return q.whereRaw(`to_char(${dateCol}, 'YYYY-MM') = ?`, [period]);
    }

    static async getByType(workspaceId, bookTypeId, filters = {}, pagination = {}) {
        const resolved = BookDataModel._resolveType(bookTypeId);
        if (!resolved) throw new Error(`Unknown book type: ${bookTypeId}`);

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;
        const { search, status, period, gstin, date_from, date_to, year, amt_min, amt_max, place_of_supply, sort_by, sort_dir = 'desc' } = filters;

        let records = [];
        let total = 0;

        if (resolved.table === 'sales') {
            // --- sales_invoices ---
            let q = knex('sales_invoices as si')
                .where('si.workspace_id', workspaceId);

            if (resolved.invoiceTypes) q = q.whereIn('si.invoice_type', resolved.invoiceTypes);
            if (resolved.bookTypes) q = q.whereIn('si.book_type', resolved.bookTypes);

            // Period, Year, and Date Range logic (Combined OR)
            q = q.where(function () {
                // If we have period, use it (ANDed with others usually, but here we treat as one of the options)
                if (period && period !== 'ALL') {
                    this.orWhere(function () {
                        BookDataModel._addPeriodFilter(this, period, 'si.invoice_date');
                    });
                }

                // Year OR Date Range
                if ((year && year !== 'ALL') || (date_from && date_to)) {
                    this.orWhere(function () {
                        if (year && year !== 'ALL') {
                            // Indian FY: April to March
                            const yrStart = `${year}-04-01`;
                            const yrEnd = `${parseInt(year) + 1}-03-31`;
                            this.whereRaw(`si.invoice_date >= ?::date AND si.invoice_date <= ?::date`, [yrStart, yrEnd]);
                        }
                        if (date_from && date_to) {
                            this.orWhereRaw(`si.invoice_date >= ?::date AND si.invoice_date <= ?::date`, [date_from, date_to]);
                        }
                    });
                } else if (!period || period === 'ALL') {
                    // No filters provided, allow all
                    this.whereRaw('1=1');
                }
            });

            if (search) {
                q = q.where(function () {
                    this.where('si.invoice_number', 'ilike', `%${search}%`)
                        .orWhere('si.customer_name', 'ilike', `%${search}%`)
                        .orWhere('si.customer_gstin', 'ilike', `%${search}%`);
                });
            }
            if (gstin) {
                q = q.where(function () {
                    this.whereRaw(`trim(si.customer_gstin) ilike ?`, [`%${gstin.trim()}%`])
                        .orWhere('si.customer_name', 'ilike', `%${gstin.trim()}%`);
                });
            }
            if (date_from) q = q.whereRaw(`si.invoice_date >= ?::date`, [date_from]);
            if (date_to) q = q.whereRaw(`si.invoice_date <= ?::date`, [date_to]);
            if (amt_min) q = q.whereRaw(`si.total_taxable_value >= ?`, [parseFloat(amt_min)]);
            if (amt_max) q = q.whereRaw(`si.total_taxable_value <= ?`, [parseFloat(amt_max)]);
            if (place_of_supply) {
                const codes = place_of_supply.split(',').filter(Boolean);
                if (codes.length > 0) {
                    q = q.where(function () {
                        codes.forEach(code => {
                            this.orWhere('si.place_of_supply', 'ilike', `${code}%`);
                        });
                    });
                }
            }
            // sales_invoices has filing_status, not status
            if (status && status !== 'all') q = q.where('si.filing_status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            let sortCol = 'si.invoice_date';
            if (sort_by === 'invoiceNo') sortCol = 'si.invoice_number';
            else if (sort_by === 'party') sortCol = 'si.customer_name';
            else if (sort_by === 'taxableAmt') sortCol = 'si.total_taxable_value';
            else if (sort_by === 'totalAmt') sortCol = 'si.total_invoice_value';
            else if (sort_by === 'date') sortCol = 'si.invoice_date';

            records = await q
                .select(
                    'si.id',
                    'si.invoice_number as invoiceNo',
                    'si.invoice_number as invoice_number',
                    knex.raw("to_char(si.invoice_date, 'DD-MM-YYYY') as date"),
                    'si.customer_name as party',
                    knex.raw("trim(si.customer_gstin) as gstin"),
                    'si.total_taxable_value as taxableAmt',
                    'si.total_cgst as cgst',
                    'si.total_sgst as sgst',
                    'si.total_igst as igst',
                    'si.total_cess as cess',
                    'si.total_invoice_value as totalAmt',
                    'si.place_of_supply as placeOfSupply',
                    knex.raw("CASE WHEN si.is_interstate THEN 'Yes' ELSE 'No' END as \"isInterstate\""),
                    'si.filing_status as status',
                    'si.invoice_type as docType',
                    'si.book_type as bookType',
                    'si.round_off as roundOff',
                    knex.raw("(SELECT description FROM sales_invoice_items WHERE invoice_id = si.id ORDER BY line_number ASC LIMIT 1) as description"),
                    knex.raw("(SELECT gst_rate_percent FROM sales_invoice_items WHERE invoice_id = si.id ORDER BY line_number ASC LIMIT 1) as \"taxPercent\"")
                )
                .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
                .limit(page_size)
                .offset(offset);

        } else if (resolved.table === 'purchase') {
            // --- purchase_vouchers ---
            let q = knex('purchase_vouchers as ev')
                .where('ev.workspace_id', workspaceId);

            if (resolved.voucherTypes) q = q.whereIn('ev.voucher_type', resolved.voucherTypes);
            if (resolved.bookTypes) q = q.whereIn('ev.book_type', resolved.bookTypes);

            // Period, Year, and Date Range logic (Combined OR)
            q = q.where(function () {
                if (period && period !== 'ALL') {
                    this.orWhere(function () {
                        BookDataModel._addPeriodFilter(this, period, 'ev.supplier_invoice_date');
                    });
                }

                if ((year && year !== 'ALL') || (date_from && date_to)) {
                    this.orWhere(function () {
                        if (year && year !== 'ALL') {
                            const yrStart = `${year}-04-01`;
                            const yrEnd = `${parseInt(year) + 1}-03-31`;
                            this.whereRaw(`ev.supplier_invoice_date >= ?::date AND ev.supplier_invoice_date <= ?::date`, [yrStart, yrEnd]);
                        }
                        if (date_from && date_to) {
                            this.orWhereRaw(`ev.supplier_invoice_date >= ?::date AND ev.supplier_invoice_date <= ?::date`, [date_from, date_to]);
                        }
                    });
                } else if (!period || period === 'ALL') {
                    this.whereRaw('1=1');
                }
            });

            if (search) {
                q = q.where(function () {
                    this.where('ev.supplier_invoice_no', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_gstin', 'ilike', `%${search}%`);
                });
            }
            if (gstin) {
                q = q.where(function () {
                    this.where('ev.supplier_gstin', 'ilike', `%${gstin.trim()}%`)
                        .orWhere('ev.supplier_name', 'ilike', `%${gstin.trim()}%`);
                });
            }
            if (date_from) q = q.whereRaw(`ev.supplier_invoice_date >= ?::date`, [date_from]);
            if (date_to) q = q.whereRaw(`ev.supplier_invoice_date <= ?::date`, [date_to]);
            if (amt_min) q = q.whereRaw(`ev.taxable_total >= ?`, [parseFloat(amt_min)]);
            if (amt_max) q = q.whereRaw(`ev.taxable_total <= ?`, [parseFloat(amt_max)]);
            if (place_of_supply) {
                const codes = place_of_supply.split(',').filter(Boolean);
                if (codes.length > 0) {
                    q = q.where(function () {
                        codes.forEach(code => {
                            this.orWhere('ev.place_of_supply', 'ilike', `${code}%`);
                        });
                    });
                }
            }
            // purchase_vouchers has a plain 'status' column
            if (status && status !== 'all') q = q.where('ev.status', status);

            const [{ count }] = await q.clone().count('* as count');
            total = parseInt(count);

            let sortCol = 'ev.supplier_invoice_date';
            if (sort_by === 'invoiceNo') sortCol = 'ev.supplier_invoice_no';
            else if (sort_by === 'party') sortCol = 'ev.supplier_name';
            else if (sort_by === 'taxableAmt') sortCol = 'ev.taxable_total';
            else if (sort_by === 'totalAmt') sortCol = 'ev.net_amount';
            else if (sort_by === 'date') sortCol = 'ev.supplier_invoice_date';

            records = await q
                .select(
                    'ev.id',
                    'ev.supplier_invoice_no as invoiceNo',
                    'ev.supplier_invoice_no as invoice_number',
                    'ev.book_vchr_no as bookVchrNo',
                    'ev.book_vchr_no as book_vchr_no',
                    knex.raw("to_char(ev.supplier_invoice_date, 'DD-MM-YYYY') as date"),
                    knex.raw("to_char(ev.book_vchr_date, 'DD-MM-YYYY') as \"bookVchrDate\""),
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
                    'ev.book_type as bookType',
                    'ev.book_type as docType',
                    'ev.round_off as roundOff',
                    knex.raw("(SELECT description FROM purchase_items WHERE purchase_id = ev.id ORDER BY id ASC LIMIT 1) as description"),
                    knex.raw("(SELECT tax_per FROM purchase_items WHERE purchase_id = ev.id ORDER BY id ASC LIMIT 1) as \"taxPercent\"")
                )
                .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
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
    /**
     * getSummary - returns aggregate totals for all 9 book types in a single call.
     * Used by the grouped cards UI to show live counts + tax breakdown per type.
     */
    static async getSummary(workspaceId, { period, year, date_from, date_to } = {}) {
        // --- Sales types ---
        const salesTypes = [
            { id: 'sales_invoice', invoiceTypes: ['B2B', 'B2C_SMALL', 'B2C_LARGE', 'EXPORT', 'SEZ'], bookTypes: null },
            { id: 'sales_return', invoiceTypes: null, bookTypes: ['SR'] },
            { id: 'cn_sales', invoiceTypes: ['CREDIT_NOTE'], bookTypes: null },
            { id: 'dn_sales', invoiceTypes: ['DEBIT_NOTE'], bookTypes: null },
        ];
        const salesResults = {};
        for (const t of salesTypes) {
            let q = knex('sales_invoices as si').where('si.workspace_id', workspaceId);
            if (t.invoiceTypes) q = q.whereIn('si.invoice_type', t.invoiceTypes);
            if (t.bookTypes) q = q.whereIn('si.book_type', t.bookTypes);

            q = q.where(function () {
                if (period && period !== 'ALL') {
                    this.orWhere(function () {
                        BookDataModel._addPeriodFilter(this, period, 'si.invoice_date');
                    });
                }
                if ((year && year !== 'ALL') || (date_from && date_to)) {
                    this.orWhere(function () {
                        if (year && year !== 'ALL') {
                            const yrStart = `${year}-04-01`;
                            const yrEnd = `${parseInt(year) + 1}-03-31`;
                            this.whereRaw(`si.invoice_date >= ?::date AND si.invoice_date <= ?::date`, [yrStart, yrEnd]);
                        }
                        if (date_from && date_to) {
                            this.orWhereRaw(`si.invoice_date >= ?::date AND si.invoice_date <= ?::date`, [date_from, date_to]);
                        }
                    });
                } else if (!period || period === 'ALL') {
                    this.whereRaw('1=1');
                }
            });

            const [row] = await q.select(
                knex.raw('COUNT(*) as total'),
                knex.raw('COALESCE(SUM(si.total_taxable_value),0) as taxable'),
                knex.raw('COALESCE(SUM(si.total_igst),0) as igst'),
                knex.raw('COALESCE(SUM(si.total_cgst),0) as cgst'),
                knex.raw('COALESCE(SUM(si.total_sgst),0) as sgst'),
                knex.raw('COALESCE(SUM(si.total_cess),0) as cess'),
                knex.raw('COALESCE(SUM(si.total_invoice_value),0) as invoice_value')
            );
            salesResults[t.id] = {
                total: parseInt(row.total),
                taxable: parseFloat(row.taxable),
                igst: parseFloat(row.igst),
                cgst: parseFloat(row.cgst),
                sgst: parseFloat(row.sgst),
                cess: parseFloat(row.cess),
                invoiceValue: parseFloat(row.invoice_value)
            };
        }

        // --- Purchase types ---
        const purchaseTypes = [
            { id: 'purchase_invoice', voucherTypes: ['PURCHASE'], bookTypes: null },
            { id: 'expense_invoice', voucherTypes: ['EXPENSE'], bookTypes: null },
            { id: 'purchase_return', voucherTypes: ['PURCHASE'], bookTypes: ['DN'] },
            { id: 'cn_purchase', voucherTypes: ['CREDIT_NOTE'], bookTypes: ['CN'] },
            { id: 'dn_purchase', voucherTypes: ['DEBIT_NOTE'], bookTypes: ['DN'] },
        ];
        const purchaseResults = {};
        for (const t of purchaseTypes) {
            let q = knex('purchase_vouchers as ev').where('ev.workspace_id', workspaceId);
            if (t.voucherTypes) q = q.whereIn('ev.voucher_type', t.voucherTypes);
            if (t.bookTypes) q = q.whereIn('ev.book_type', t.bookTypes);

            q = q.where(function () {
                if (period && period !== 'ALL') {
                    this.orWhere(function () {
                        BookDataModel._addPeriodFilter(this, period, 'ev.supplier_invoice_date');
                    });
                }
                if ((year && year !== 'ALL') || (date_from && date_to)) {
                    this.orWhere(function () {
                        if (year && year !== 'ALL') {
                            const yrStart = `${year}-04-01`;
                            const yrEnd = `${parseInt(year) + 1}-03-31`;
                            this.whereRaw(`ev.supplier_invoice_date >= ?::date AND ev.supplier_invoice_date <= ?::date`, [yrStart, yrEnd]);
                        }
                        if (date_from && date_to) {
                            this.orWhereRaw(`ev.supplier_invoice_date >= ?::date AND ev.supplier_invoice_date <= ?::date`, [date_from, date_to]);
                        }
                    });
                } else if (!period || period === 'ALL') {
                    this.whereRaw('1=1');
                }
            });

            const [row] = await q.select(
                knex.raw('COUNT(*) as total'),
                knex.raw('COALESCE(SUM(ev.taxable_total),0) as taxable'),
                knex.raw('COALESCE(SUM(ev.total_igst_amount),0) as igst'),
                knex.raw('COALESCE(SUM(ev.total_cgst_amount),0) as cgst'),
                knex.raw('COALESCE(SUM(ev.total_sgst_amount),0) as sgst'),
                knex.raw('COALESCE(SUM(ev.total_cess_amount),0) as cess'),
                knex.raw('COALESCE(SUM(ev.net_amount),0) as invoice_value')
            );
            purchaseResults[t.id] = {
                total: parseInt(row.total),
                taxable: parseFloat(row.taxable),
                igst: parseFloat(row.igst),
                cgst: parseFloat(row.cgst),
                sgst: parseFloat(row.sgst),
                cess: parseFloat(row.cess),
                invoiceValue: parseFloat(row.invoice_value)
            };
        }

        return { ...salesResults, ...purchaseResults };
    }

    /**
     * getById - retrieves a single document by ID from either sales or purchase tables.
     */
    static async getById(workspaceId, id) {
        // Try purchase_vouchers first (since this is mostly used for reconciliation/vouchers)
        let record = await knex('purchase_vouchers')
            .where({ id, workspace_id: workspaceId })
            .first();

        if (record) {
            // Fetch items/line details if needed, for now return main record
            return record;
        }

        // Check sales_invoices
        record = await knex('sales_invoices')
            .where({ id, workspace_id: workspaceId })
            .first();

        return record || null;
    }

    /**
     * Get B2B purchase vouchers for the reconciliation dashboard (Book Data tab)
     */
    static async getReconBookData(workspaceId, filters = {}) {
        const { gstin_id, fy_id, month, quarter, search, page = 1, page_size = 25 } = filters;

        let query = knex('purchase_vouchers as pi')
            .where('pi.workspace_id', workspaceId)
            .andWhere(builder => {
                builder.whereNotNull('pi.supplier_gstin')
                    .andWhereNot('pi.supplier_gstin', '')
                    .andWhereNotNull('pi.supplier_invoice_no')
                    .andWhereNot('pi.supplier_invoice_no', '');
            });

        if (gstin_id && gstin_id !== 'ALL') {
            query = query.where('pi.gstin_id', gstin_id);
        }
        if (fy_id && fy_id !== 'ALL') {
            query = query.where('pi.fy_id', fy_id);
        }
        if (month && month !== 'ALL') {
            query = query.where('pi.month', month);
        }
        if (quarter && quarter !== 'ALL') {
            query = query.where('pi.quarter', quarter);
        }

        if (search) {
            query = query.where(function () {
                this.where('pi.supplier_invoice_no', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_gstin', 'ilike', `%${search}%`)
                    .orWhere('pi.supplier_name', 'ilike', `%${search}%`);
            });
        }

        // Select fields aliased for frontend consistency
        query = query.leftJoin('reconciliation_status as rs', 'pi.id', 'rs.book_data_id')
            .select(
                'pi.id',
                'pi.supplier_gstin',
                'pi.supplier_name',
                'pi.supplier_invoice_no as purchase_invoice_number',
                'pi.supplier_invoice_no as invoice_no',
                'pi.supplier_invoice_date as purchase_invoice_date',
                'pi.supplier_invoice_date as date',
                'pi.net_amount as purchase_invoice_total',
                'pi.taxable_total as purchase_taxable',
                knex.raw('(COALESCE(pi.total_igst_amount,0) + COALESCE(pi.total_cgst_amount,0) + COALESCE(pi.total_sgst_amount,0) + COALESCE(pi.total_cess_amount,0)) as purchase_tax'),
                'pi.total_igst_amount as purchase_igst',
                'pi.total_cgst_amount as purchase_cgst',
                'pi.total_sgst_amount as purchase_sgst',
                'pi.total_cess_amount as purchase_cess',
                'pi.book_vchr_no',
                'pi.book_vchr_date',
                'pi.voucher_type as purchase_voucher_type',
                'pi.source_section as gst_type',
                knex.raw('COALESCE(rs.recon_status, \'pending\') as action_status'),
                knex.raw('COALESCE(rs.recon_status, \'pending\') as reconciliation_status'),
                knex.raw('\'missing_in_portal\' as match_status') // Default for untracked book data in recon view
            );

        // Count totals
        const totalsQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
        const totalsResult = await totalsQuery;

        const results = await query.orderBy('pi.supplier_invoice_date', 'desc')
            .limit(page_size)
            .offset((page - 1) * page_size);

        return {
            results,
            pagination: {
                total: parseInt(totalsResult?.total || 0),
                page: parseInt(page),
                page_size: parseInt(page_size)
            }
        };
    }
}

module.exports = BookDataModel;

