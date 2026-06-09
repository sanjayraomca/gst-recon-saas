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
                return { table: 'purchase', bookTypes: ['PR'], voucherTypes: ['PURCHASE'] };
            case 'cn_purchase':
                return { table: 'purchase', voucherTypes: ['CREDIT_NOTE'], bookTypes: ['CN'] };
            case 'dn_purchase':
                return { table: 'purchase', voucherTypes: ['DEBIT_NOTE'], bookTypes: ['DN'] };
            case 'customer':
                return { table: 'sales' };
            case 'supplier':
                return { table: 'purchase' };
            default:
                return null;
        }
    }

    static _resolveMultipleTypes(bookTypeId) {
        const typeIds = String(bookTypeId).split(',').filter(Boolean);
        if (typeIds.length === 0) return null;

        const resolvedList = typeIds.map(id => BookDataModel._resolveType(id)).filter(Boolean);
        if (resolvedList.length === 0) return null;

        const table = resolvedList[0].table;
        if (resolvedList.some(r => r.table !== table)) return null; // Cannot mix tables

        return {
            table,
            types: resolvedList
        };
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

    /**
     * _applyColumnFilters - Helper to apply dynamic column-level filters (JSON-based)
     * Supports various operations like eq, cn, bw, gt, lt, etc.
     */
    static _applyColumnFilters(q, columnFilters, mapping, useHaving = false) {
        if (!columnFilters || Object.keys(columnFilters).length === 0) return q;

        const numericFields = ['taxableAmt', 'igst', 'cgst', 'sgst', 'cess', 'totalAmt', 'net', 'netAmount', 'roundOff', 'invoice_amount', 'row_total', 'tax_per', 'taxPer', 'taxRate'];
        const dateFields = ['date', 'ref_vchr_date', 'bookVchrDate', 'voucher_date', 'purchase_invoice_date', 'invoice_date'];

        Object.entries(columnFilters).forEach(([colKey, filter]) => {
            if (!filter || (!filter.val && !['nu', 'nn'].includes(filter.op))) return;

            const dbCol = mapping[colKey];
            if (!dbCol) return;

            const { op, val } = filter;
            const lowVal = String(val || '').toLowerCase();

            const apply = (sql, params) => {
                if (useHaving) q.havingRaw(sql, params);
                else q.whereRaw(sql, params);
            };

            const isNumeric = numericFields.includes(colKey);
            const isDate = dateFields.includes(colKey);
            const colSql = (dbCol && typeof dbCol === 'object') ? dbCol.toString() : dbCol;

            if (isNumeric) {
                const num = parseFloat(val);
                if (isNaN(num) && !['nu', 'nn'].includes(op)) return;
                const baseSql = `ROUND(COALESCE((${colSql})::numeric, 0)::numeric, 2)`;

                switch (op) {
                    case 'eq': apply(`${baseSql} = ?`, [num]); break;
                    case 'ne': apply(`${baseSql} != ?`, [num]); break;
                    case 'lt': apply(`${baseSql} < ?`, [num]); break;
                    case 'le': apply(`${baseSql} <= ?`, [num]); break;
                    case 'gt': apply(`${baseSql} > ?`, [num]); break;
                    case 'ge': apply(`${baseSql} >= ?`, [num]); break;
                    case 'nu': apply(`(${colSql}) IS NULL`); break;
                    case 'nn': apply(`(${colSql}) IS NOT NULL`); break;
                    default: apply(`${baseSql} = ?`, [num]);
                }
            } else if (isDate) {
                let dbDate = val;
                const dateParts = String(val).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                if (dateParts) {
                    dbDate = `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`;
                }

                switch (op) {
                    case 'eq': apply(`(${colSql})::date = ?::date`, [dbDate]); break;
                    case 'ne': apply(`(${colSql})::date != ?::date`, [dbDate]); break;
                    case 'lt': apply(`(${colSql})::date < ?::date`, [dbDate]); break;
                    case 'le': apply(`(${colSql})::date <= ?::date`, [dbDate]); break;
                    case 'gt': apply(`(${colSql})::date > ?::date`, [dbDate]); break;
                    case 'ge': apply(`(${colSql})::date >= ?::date`, [dbDate]); break;
                    case 'cn': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`%${lowVal}%`]); break;
                    case 'bw': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`${lowVal}%`]); break;
                    case 'ew': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`%${lowVal}`]); break;
                    case 'nu': apply(`(${colSql}) IS NULL`); break;
                    case 'nn': apply(`(${colSql}) IS NOT NULL`); break;
                    default: apply(`(${colSql})::date = ?::date`, [dbDate]);
                }
            } else {
                switch (op) {
                    case 'eq': apply(`LOWER(CAST(${colSql} AS TEXT)) = ?`, [lowVal]); break;
                    case 'ne': apply(`LOWER(CAST(${colSql} AS TEXT)) != ?`, [lowVal]); break;
                    case 'bw': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`${lowVal}%`]); break;
                    case 'bn': apply(`LOWER(CAST(${colSql} AS TEXT)) NOT LIKE ?`, [`${lowVal}%`]); break;
                    case 'ew': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`%${lowVal}`]); break;
                    case 'en': apply(`LOWER(CAST(${colSql} AS TEXT)) NOT LIKE ?`, [`%${lowVal}`]); break;
                    case 'cn': apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`%${lowVal}%`]); break;
                    case 'nc': apply(`LOWER(CAST(${colSql} AS TEXT)) NOT LIKE ?`, [`%${lowVal}%`]); break;
                    case 'nu': apply(`CAST(${colSql} AS TEXT) IS NULL OR CAST(${colSql} AS TEXT) = ''`, []); break;
                    case 'nn': apply(`CAST(${colSql} AS TEXT) IS NOT NULL AND CAST(${colSql} AS TEXT) != ''`, []); break;
                    default: apply(`LOWER(CAST(${colSql} AS TEXT)) LIKE ?`, [`%${lowVal}%`]);
                }
            }
        });
        return q;
    }

    /**
     * _applyAdvancedFilters - Shared logic for sidebar/adv filters.
     */
    static _applyAdvancedFilters(q, filters, mapping) {
        // GSTINs (Multi)
        if (filters.gstins && Array.isArray(filters.gstins) && filters.gstins.length > 0) {
            q.whereIn(mapping.gstin, filters.gstins);
        }
        // Parties (Multi)
        if (filters.parties && Array.isArray(filters.parties) && filters.parties.length > 0) {
            q.whereIn(mapping.party, filters.parties);
        }
        // Supply Type
        if (filters.supply_type === 'INTERSTATE') {
            q.where(mapping.is_interstate, true);
        } else if (filters.supply_type === 'INTRASTATE') {
            q.where(mapping.is_interstate, false);
        }
        // Roundoff only
        if (filters.roundoff_only === 'true' || filters.roundoff_only === true || filters.roundoff_only == 1) {
            q.whereRaw(`COALESCE(${mapping.roundoff}, 0) != 0`);
        }
        // Amount Range (Taxable)
        if (filters.amt_min) q.whereRaw(`${mapping.taxableAmt} >= ?`, [parseFloat(filters.amt_min)]);
        if (filters.amt_max) q.whereRaw(`${mapping.taxableAmt} <= ?`, [parseFloat(filters.amt_max)]);
        // Amount Range (Net)
        if (filters.amt_net_min) q.whereRaw(`${mapping.totalAmt} >= ?`, [parseFloat(filters.amt_net_min)]);
        if (filters.amt_net_max) q.whereRaw(`${mapping.totalAmt} <= ?`, [parseFloat(filters.amt_net_max)]);

        // Place of Supply (Multi)
        if (filters.place_of_supply) {
            const codes = String(filters.place_of_supply).split(',').filter(Boolean);
            if (codes.length > 0) {
                q.where(function () {
                    codes.forEach((code, idx) => {
                        const trimmed = code.trim();
                        const normalized = trimmed.padStart(2, '0');

                        const condition = function () {
                            this.where(mapping.placeOfSupply, '=', normalized)
                                .orWhere(mapping.placeOfSupply, 'ilike', `${normalized} -%`)
                                .orWhere(mapping.placeOfSupply, '=', trimmed)
                                .orWhere(mapping.placeOfSupply, 'ilike', `${trimmed} -%`);
                        };

                        if (idx === 0) this.where(condition);
                        else this.orWhere(condition);
                    });
                });
            }
        }
        return q;
    }

    static async getByType(workspaceId, bookTypeId, filters = {}, pagination = {}) {
        const resolved = BookDataModel._resolveMultipleTypes(bookTypeId);
        if (!resolved) throw new Error(`Unknown or mismatched book types: ${bookTypeId}`);

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;
        const {
            search, status, period, gstin, date_from, date_to, year,
            amt_min, amt_max, amt_net_min, amt_net_max,
            place_of_supply, sort_by, sort_dir = 'desc',
            import_filing_id
        } = filters;

        let records = [];
        let total = 0;
        let summary = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, roundOff: 0, net: 0 };
        const group_by_supplier = filters.group_by_supplier === 'true' || filters.group_by === 'supplier' || filters.grouped === 'true';

        if (resolved.table === 'sales') {
            // --- sales_invoices ---
            let q = knex('sales_invoices as si')
                .leftJoin('gstr_import_master as im', 'si.import_filing_id', 'im.import_filing_id')
                .leftJoin('users as u', 'si.created_by', 'u.id')
                .where('si.workspace_id', workspaceId);

            if (import_filing_id) {
                q = q.where('si.import_filing_id', import_filing_id);
            }

            // Multi-type OR filter
            q = q.where(function () {
                resolved.types.forEach(t => {
                    this.orWhere(function () {
                        if (t.invoiceTypes) this.whereIn('si.invoice_type', t.invoiceTypes);
                        if (t.bookTypes) this.whereIn('si.book_type', t.bookTypes);
                    });
                });
            });

            // Advanced filters
            BookDataModel._applyAdvancedFilters(q, filters, {
                gstin: 'si.customer_gstin',
                party: 'si.customer_name',
                is_interstate: 'si.is_interstate',
                roundoff: 'si.round_off',
                taxableAmt: 'si.total_taxable_value',
                totalAmt: 'si.total_invoice_value',
                placeOfSupply: 'si.place_of_supply'
            });

            // Column filters mapping
            const colMapping = {
                invoiceNo: 'si.invoice_number',
                date: 'si.invoice_date',
                party: 'si.customer_name',
                gstin: 'si.customer_gstin',
                taxableAmt: 'si.total_taxable_value',
                igst: 'si.total_igst',
                cgst: 'si.total_cgst',
                sgst: 'si.total_sgst',
                cess: 'si.total_cess',
                totalAmt: 'si.total_invoice_value',
                net: 'si.total_invoice_value',
                netAmount: 'si.total_invoice_value',
                roundOff: 'si.round_off',
                status: 'si.filing_status',
                docType: 'si.invoice_type',
                gstType: knex.raw("UPPER(COALESCE(si.invoice_type, 'NONGST'))"),
                placeOfSupply: 'si.place_of_supply'
            };

            let cf = filters.column_filters || pagination.columnFilters;
            if (cf) {
                if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf); } catch (e) { cf = null; }
                }
                if (cf && Object.keys(cf).length > 0) {
                    BookDataModel._applyColumnFilters(q, cf, colMapping);
                }
            }

            // Apply legacy period/search logic alongside new filters for full composability
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

            // sales_invoices has filing_status, not status
            if (status && status !== 'all') q = q.where('si.filing_status', status);

            // Advanced filters
            BookDataModel._applyAdvancedFilters(q, filters, {
                gstin: 'si.customer_gstin',
                party: 'si.customer_name',
                is_interstate: 'si.is_interstate',
                roundoff: 'si.round_off',
                taxableAmt: 'si.total_taxable_value',
                totalAmt: 'si.total_invoice_value',
                placeOfSupply: 'si.place_of_supply'
            });

            const summaryQuery = q.clone().select(
                knex.raw(group_by_supplier ? 'count(distinct (coalesce(trim(si.customer_gstin), \'\'), coalesce(trim(si.customer_name), \'\'))) as count' : 'count(*) as count'),
                knex.raw('count(*) as total_records'),
                knex.raw('sum(total_taxable_value) as total_taxable'),
                knex.raw('sum(total_igst) as total_igst'),
                knex.raw('sum(total_cgst) as total_cgst'),
                knex.raw('sum(total_sgst) as total_sgst'),
                knex.raw('sum(total_cess) as total_cess'),
                knex.raw('sum(total_invoice_value) as total_net'),
                knex.raw('sum(round_off) as total_round_off')
            ).first();

            const summaryResult = await summaryQuery;
            total = parseInt(summaryResult.count || 0);
            summary = {
                totalCount: parseInt(summaryResult.total_records || 0),
                taxable: parseFloat(summaryResult.total_taxable || 0),
                igst: parseFloat(summaryResult.total_igst || 0),
                cgst: parseFloat(summaryResult.total_cgst || 0),
                sgst: parseFloat(summaryResult.total_sgst || 0),
                cess: parseFloat(summaryResult.total_cess || 0),
                net: parseFloat(summaryResult.total_net || 0),
                roundOff: parseFloat(summaryResult.total_round_off || 0)
            };

            let sortCol = 'si.invoice_date';
            if (group_by_supplier) {
                if (sort_by === 'party') sortCol = 'party';
                else if (sort_by === 'gstin' || sort_by === 'gstNo') sortCol = 'gstin';
                else if (sort_by === 'taxableAmt') sortCol = knex.raw(' sum(si.total_taxable_value) ');
                else if (sort_by === 'totalAmt' || sort_by === 'netAmount' || sort_by === 'net') sortCol = knex.raw(' sum(si.total_invoice_value) ');
                else if (sort_by === 'igst') sortCol = knex.raw(' sum(si.total_igst) ');
                else if (sort_by === 'cgst') sortCol = knex.raw(' sum(si.total_cgst) ');
                else if (sort_by === 'sgst') sortCol = knex.raw(' sum(si.total_sgst) ');
                else if (sort_by === 'cess') sortCol = knex.raw(' sum(si.total_cess) ');
                else if (sort_by === 'roundOff') sortCol = knex.raw(' sum(si.round_off) ');
                else if (sort_by === 'invoiceCount' || sort_by === 'rows_len') sortCol = knex.raw(' count(*) ');
                else if (sort_by === 'placeOfSupply') sortCol = knex.raw(' max(si.place_of_supply) ');
                else if (sort_by === 'gstType') sortCol = knex.raw(' max(si.invoice_type) ');
                else if (sort_by === 'platform') sortCol = knex.raw(' max(si.platform) ');
                else sortCol = 'party'; // Fallback
            } else {
                if (sort_by === 'invoiceNo') sortCol = 'si.invoice_number';
                else if (sort_by === 'party') sortCol = 'si.customer_name';
                else if (sort_by === 'gstin' || sort_by === 'gstNo') sortCol = 'si.customer_gstin';
                else if (sort_by === 'taxableAmt') sortCol = 'si.total_taxable_value';
                else if (sort_by === 'totalAmt' || sort_by === 'net') sortCol = 'si.total_invoice_value';
                else if (sort_by === 'date') sortCol = 'si.invoice_date';
                else if (sort_by === 'igst') sortCol = 'si.total_igst';
                else if (sort_by === 'cgst') sortCol = 'si.total_cgst';
                else if (sort_by === 'sgst') sortCol = 'si.total_sgst';
                else if (sort_by === 'cess') sortCol = 'si.total_cess';
                else if (sort_by === 'roundOff') sortCol = 'si.round_off';
                else if (sort_by === 'placeOfSupply') sortCol = 'si.place_of_supply';
                else if (sort_by === 'gstType') sortCol = 'si.invoice_type';
                else if (sort_by === 'platform') sortCol = 'si.platform';
                else if (sort_by === 'isInterstate') sortCol = 'si.is_interstate';
                else if (sort_by === 'taxPercent') sortCol = knex.raw("(SELECT gst_rate_percent FROM sales_invoice_items WHERE invoice_id = si.id ORDER BY line_number ASC LIMIT 1)");
                else if (sort_by === 'invoiceCount' || sort_by === 'rows_len') sortCol = knex.raw(' count(*) OVER (PARTITION BY COALESCE(NULLIF(si.customer_gstin, \'\'), si.customer_name)) ');
            }

            if (group_by_supplier) {
                records = await q
                    .select(
                        knex.raw('trim(si.customer_name) as party'),
                        knex.raw('trim(si.customer_gstin) as gstin'),
                        knex.raw('sum(si.total_taxable_value) as "taxableAmt"'),
                        knex.raw('sum(si.total_cgst) as cgst'),
                        knex.raw('sum(si.total_sgst) as sgst'),
                        knex.raw('sum(si.total_igst) as igst'),
                        knex.raw('sum(si.total_cess) as cess'),
                        knex.raw('sum(si.total_invoice_value) as "totalAmt"'),
                        knex.raw('sum(si.round_off) as "roundOff"'),
                        knex.raw('count(*) as "invoiceCount"'),
                        knex.raw('max(si.place_of_supply) as "placeOfSupply"'),
                        knex.raw('UPPER(max(si.invoice_type)) as "gstType"'),
                        knex.raw('max(si.platform) as platform')
                    )
                    .groupByRaw('trim(si.customer_gstin), trim(si.customer_name)')
                    .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
                    .limit(page_size)
                    .offset(offset);
            } else {
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
                        knex.raw("UPPER(COALESCE(si.invoice_type, 'NONGST')) as \"gstType\""),
                        'si.invoice_type as docType',
                        'si.book_type as bookType',
                        'si.round_off as roundOff',
                        'si.platform',
                        knex.raw("(SELECT description FROM sales_invoice_items WHERE invoice_id = si.id ORDER BY line_number ASC LIMIT 1) as description"),
                        knex.raw("(SELECT gst_rate_percent FROM sales_invoice_items WHERE invoice_id = si.id ORDER BY line_number ASC LIMIT 1) as \"taxPercent\""),
                        'im.user_email as imported_by_email',
                        'im.upload_timestamp as imported_at',
                        'im.original_filename as imported_from_file',
                        'im.import_type as imported_via',
                        'si.created_at',
                        'u.email as created_by_email',
                        'u.full_name as created_by_name'
                    )
                    .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
                    .limit(page_size)
                    .offset(offset);
            }

        } else if (resolved.table === 'purchase') {
            // --- purchase_vouchers ---
            let q = knex('purchase_vouchers as ev')
                .leftJoin('reconciliation_status as rs', 'ev.id', 'rs.book_data_id')
                .leftJoin('purchase_items as pi', 'ev.id', 'pi.purchase_id')
                .leftJoin('gstr_import_master as im', 'ev.import_filing_id', 'im.import_filing_id')
                .leftJoin('users as u', 'ev.created_by', 'u.id')
                .where('ev.workspace_id', workspaceId);

            if (import_filing_id) {
                q = q.where('ev.import_filing_id', import_filing_id);
            }

            // Multi-type OR filter
            q = q.where(function () {
                resolved.types.forEach(t => {
                    this.orWhere(function () {
                        if (t.voucherTypes) this.whereIn('ev.voucher_type', t.voucherTypes);
                        if (t.bookTypes) this.whereIn('ev.book_type', t.bookTypes);
                    });
                });
            });

            // Advanced filters
            BookDataModel._applyAdvancedFilters(q, filters, {
                gstin: 'ev.supplier_gstin',
                party: 'ev.supplier_name',
                is_interstate: 'ev.is_interstate',
                roundoff: 'ev.round_off',
                taxableAmt: 'pi.taxable_amount',
                totalAmt: 'pi.row_total',
                row_total: 'pi.row_total',
                invoice_amount: 'pi.invoice_amount',
                placeOfSupply: 'ev.place_of_supply'
            });

            // Column filters mapping
            const colMappingPr = {
                invoiceNo: 'ev.supplier_invoice_no', // legacy
                ref_vchr_no: 'ev.supplier_invoice_no', // UI key
                bookVchrNo: 'ev.book_vchr_no',
                date: 'ev.supplier_invoice_date', // legacy
                ref_vchr_date: 'ev.supplier_invoice_date', // UI key
                bookVchrDate: 'ev.book_vchr_date',
                party: 'ev.supplier_name',
                gstin: 'ev.supplier_gstin',
                taxableAmt: 'pi.taxable_amount',
                igst: 'pi.igst_amount',
                cgst: 'pi.cgst_amount',
                sgst: 'pi.sgst_amount',
                cess: 'pi.cess_amount',
                totalAmt: 'pi.row_total',
                row_total: 'pi.row_total',
                net: 'pi.row_total',
                netAmount: 'pi.row_total',
                invoice_amount: 'pi.invoice_amount',
                roundOff: 'ev.round_off',
                status: 'ev.status',
                docType: 'ev.book_type',
                vchType: 'ev.voucher_type',
                gstType: knex.raw("COALESCE(NULLIF(UPPER(ev.source_section), 'EXPENSE'), NULLIF(UPPER(ev.voucher_type), 'EXPENSE'), 'NONGST')"),
                placeOfSupply: 'ev.place_of_supply'
            };

            let cfPr = filters.column_filters || pagination.columnFilters;
            if (cfPr) {
                if (typeof cfPr === 'string') {
                    try { cfPr = JSON.parse(cfPr); } catch (e) { cfPr = null; }
                }
                if (cfPr && Object.keys(cfPr).length > 0) {
                    if (group_by_supplier) {
                        const aggregateKeys = ['taxableAmt', 'igst', 'cgst', 'sgst', 'cess', 'roundOff', 'totalAmt', 'totalInvoiceCount', 'invoiceCount'];
                        const whereCF = {};
                        const havingCF = {};
                        Object.entries(cfPr).forEach(([k, v]) => {
                            if (aggregateKeys.includes(k)) havingCF[k] = v;
                            else whereCF[k] = v;
                        });

                        BookDataModel._applyColumnFilters(q, whereCF, colMappingPr);

                        // Mapping for aggregates in HAVING
                        const aggMapping = {
                            taxableAmt: 'sum(pi.taxable_amount)',
                            igst: 'sum(pi.igst_amount)',
                            cgst: 'sum(pi.cgst_amount)',
                            sgst: 'sum(pi.sgst_amount)',
                            cess: 'sum(pi.cess_amount)',
                            roundOff: 'sum(ev.round_off)',
                            totalAmt: 'sum(pi.row_total)',
                            row_total: 'sum(pi.row_total)',
                            invoice_amount: 'sum(pi.invoice_amount)',
                            totalInvoiceCount: 'count(distinct ev.id)',
                            invoiceCount: 'count(distinct ev.id)'
                        };
                        BookDataModel._applyColumnFilters(q, havingCF, aggMapping, true);
                    } else {
                        BookDataModel._applyColumnFilters(q, cfPr, colMappingPr);
                    }
                }
            }

            // Apply legacy logic alongside new filters
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
                        .orWhere('ev.supplier_gstin', 'ilike', `%${search}%`)
                        .orWhere('ev.book_vchr_no', 'ilike', `%${search}%`)
                        .orWhere('ev.voucher_type', 'ilike', `%${search}%`)
                        .orWhere('ev.source_section', 'ilike', `%${search}%`)
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

            // purchase_vouchers has a plain 'status' column
            if (status && status !== 'all') q = q.where('ev.status', status);

            const summaryQuery = q.clone().select(
                knex.raw(group_by_supplier ? 'count(distinct (coalesce(trim(ev.supplier_gstin), \'\'), coalesce(trim(ev.supplier_name), \'\'))) as count' : 'count(*) as count'),
                knex.raw('count(*) as total_records'),
                knex.raw('sum(pi.taxable_amount) as total_taxable'),
                knex.raw('sum(pi.igst_amount) as total_igst'),
                knex.raw('sum(pi.cgst_amount) as total_cgst'),
                knex.raw('sum(pi.sgst_amount) as total_sgst'),
                knex.raw('sum(pi.cess_amount) as total_cess'),
                knex.raw('sum(ev.round_off) as total_round_off'),
                knex.raw('sum(ev.net_amount / (SELECT GREATEST(count(*), 1) FROM purchase_items WHERE purchase_id = ev.id)) as total_net'),
                knex.raw('sum(pi.invoice_amount) as total_invoice_amount')
            ).first();

            const summaryResult = await summaryQuery;
            total = parseInt(summaryResult.count || 0);
            summary = {
                totalCount: parseInt(summaryResult.total_records || 0),
                taxable: parseFloat(summaryResult.total_taxable || 0),
                igst: parseFloat(summaryResult.total_igst || 0),
                cgst: parseFloat(summaryResult.total_cgst || 0),
                sgst: parseFloat(summaryResult.total_sgst || 0),
                cess: parseFloat(summaryResult.total_cess || 0),
                roundOff: parseFloat(summaryResult.total_round_off || 0),
                net: parseFloat(summaryResult.total_net || 0),
                invoice_amount: parseFloat(summaryResult.total_invoice_amount || 0)
            };

            let sortCol = 'ev.supplier_invoice_date';
            if (group_by_supplier) {
                if (sort_by === 'party') sortCol = 'party';
                else if (sort_by === 'gstin' || sort_by === 'gstNo') sortCol = 'gstin';
                else if (sort_by === 'taxableAmt') sortCol = knex.raw(' sum(pi.taxable_amount) ');
                else if (sort_by === 'row_total') sortCol = knex.raw(' sum(pi.row_total) ');
                else if (sort_by === 'totalAmt' || sort_by === 'netAmount' || sort_by === 'net') sortCol = knex.raw(' sum(ev.net_amount / (SELECT GREATEST(count(*), 1) FROM purchase_items WHERE purchase_id = ev.id)) ');
                else if (sort_by === 'invoice_amount') sortCol = knex.raw(' sum(pi.invoice_amount) ');
                else if (sort_by === 'igst') sortCol = knex.raw(' sum(pi.igst_amount) ');
                else if (sort_by === 'cgst') sortCol = knex.raw(' sum(pi.cgst_amount) ');
                else if (sort_by === 'sgst') sortCol = knex.raw(' sum(pi.sgst_amount) ');
                else if (sort_by === 'cess') sortCol = knex.raw(' sum(pi.cess_amount) ');
                else if (sort_by === 'roundOff') sortCol = knex.raw(' sum(ev.round_off) ');
                else if (sort_by === 'invoiceCount' || sort_by === 'rows_len') sortCol = knex.raw(' count(distinct ev.id) ');
                else if (sort_by === 'placeOfSupply') sortCol = knex.raw(' max(ev.place_of_supply) ');
                else if (sort_by === 'gstType') sortCol = knex.raw(' max(pi.invoice_type) ');
                else if (sort_by === 'platform') sortCol = knex.raw(' max(pi.platform) ');
                else sortCol = 'party'; // Default fallback that is safe for GROUP BY
            } else {
                if (sort_by === 'invoiceNo' || sort_by === 'ref_vchr_no') sortCol = 'ev.supplier_invoice_no';
                else if (sort_by === 'party') sortCol = 'ev.supplier_name';
                else if (sort_by === 'gstin' || sort_by === 'gstNo') sortCol = 'ev.supplier_gstin';
                else if (sort_by === 'taxableAmt') sortCol = 'pi.taxable_amount';
                else if (sort_by === 'row_total') sortCol = 'pi.row_total';
                else if (sort_by === 'totalAmt' || sort_by === 'netAmount' || sort_by === 'net') sortCol = 'ev.net_amount';
                else if (sort_by === 'invoice_amount') sortCol = 'pi.invoice_amount';
                else if (sort_by === 'date' || sort_by === 'ref_vchr_date') sortCol = 'ev.supplier_invoice_date';
                else if (sort_by === 'bookVchrNo') sortCol = 'ev.book_vchr_no';
                else if (sort_by === 'bookVchrDate') sortCol = 'ev.book_vchr_date';
                else if (sort_by === 'igst') sortCol = 'pi.igst_amount';
                else if (sort_by === 'cgst') sortCol = 'pi.cgst_amount';
                else if (sort_by === 'sgst') sortCol = 'pi.sgst_amount';
                else if (sort_by === 'cess') sortCol = 'pi.cess_amount';
                else if (sort_by === 'roundOff') sortCol = 'ev.round_off';
                else if (sort_by === 'placeOfSupply') sortCol = 'ev.place_of_supply';
                else if (sort_by === 'gstType') sortCol = 'pi.invoice_type';
                else if (sort_by === 'platform') sortCol = 'pi.platform';
                else if (sort_by === 'isInterstate') sortCol = 'ev.is_interstate';
                else if (sort_by === 'reverseCharge') sortCol = 'ev.is_rcm';
                else if (sort_by === 'taxPercent') sortCol = 'pi.gst_rate_percent';
                else if (sort_by === 'invoiceCount' || sort_by === 'rows_len') sortCol = knex.raw(' count(ev.id) OVER (PARTITION BY COALESCE(NULLIF(ev.supplier_gstin, \'\'), ev.supplier_name)) ');
            }

            if (group_by_supplier) {
                records = await q
                    .select(
                        knex.raw('trim(ev.supplier_name) as party'),
                        knex.raw('trim(ev.supplier_gstin) as gstin'),
                        knex.raw('sum(pi.taxable_amount) as "taxableAmt"'),
                        knex.raw('sum(pi.cgst_amount) as cgst'),
                        knex.raw('sum(pi.sgst_amount) as sgst'),
                        knex.raw('sum(pi.igst_amount) as igst'),
                        knex.raw('sum(pi.cess_amount) as cess'),
                        knex.raw('sum(ev.net_amount / (SELECT GREATEST(count(*), 1) FROM purchase_items WHERE purchase_id = ev.id)) as "totalAmt"'),
                        knex.raw('sum(ev.round_off) as "roundOff"'),
                        knex.raw('count(distinct ev.id) as "invoiceCount"'),
                        knex.raw('max(ev.place_of_supply) as "placeOfSupply"'),
                        knex.raw('COALESCE(NULLIF(UPPER(max(ev.source_section)), \'EXPENSE\'), NULLIF(UPPER(max(ev.voucher_type)), \'EXPENSE\'), \'NONGST\') as "gstType"'),
                        knex.raw('max(ev.voucher_type) as "vchType"')
                    )
                    .groupByRaw('trim(ev.supplier_gstin), trim(ev.supplier_name)')
                    .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
                    .limit(page_size)
                    .offset(offset);
            } else {
                records = await q
                    .select(
                        'ev.id',
                        'pi.id as item_id',
                        'ev.supplier_invoice_no as invoiceNo',
                        'ev.supplier_invoice_no as invoice_number',
                        'ev.book_vchr_no as bookVchrNo',
                        'ev.book_vchr_no as book_vchr_no',
                        knex.raw("to_char(ev.supplier_invoice_date, 'DD-MM-YYYY') as date"),
                        knex.raw("to_char(ev.book_vchr_date, 'DD-MM-YYYY') as \"bookVchrDate\""),
                        'ev.supplier_name as party',
                        'ev.supplier_gstin as gstin',
                        'pi.taxable_amount as taxableAmt',
                        'pi.cgst_amount as cgst',
                        'pi.sgst_amount as sgst',
                        'pi.igst_amount as igst',
                        'pi.cess_amount as cess',
                        'ev.net_amount as totalAmt',
                        'pi.row_total as row_total',
                        'pi.invoice_amount as invoice_amount',
                        'ev.place_of_supply as placeOfSupply',
                        'ev.is_interstate as isInterstate',
                        'ev.status',
                        'ev.book_type as bookType',
                        'ev.book_type as docType',
                        'ev.voucher_type as vchType',
                        'ev.voucher_type',
                        knex.raw("COALESCE(NULLIF(UPPER(ev.source_section), 'EXPENSE'), NULLIF(UPPER(ev.voucher_type), 'EXPENSE'), 'NONGST') as \"gstType\""),
                        'ev.is_rcm as reverseCharge',
                        'ev.round_off as roundOff',
                        'rs.recon_status as workflow_status',
                        knex.raw("COALESCE(rs.extra_info->>'match_status', 'missing_in_portal') as match_status"),
                        knex.raw("count(ev.id) OVER (PARTITION BY COALESCE(NULLIF(ev.supplier_gstin, ''), ev.supplier_name)) as \"invoiceCount\""),
                        'pi.description as description',
                        'pi.tax_per as taxPercent',
                        'pi.platform as platform',
                        'im.user_email as imported_by_email',
                        'im.upload_timestamp as imported_at',
                        'im.original_filename as imported_from_file',
                        'im.import_type as imported_via',
                        'ev.created_at',
                        'u.email as created_by_email',
                        'u.full_name as created_by_name'
                    )
                    .orderBy(sortCol, sort_dir === 'asc' ? 'asc' : 'desc')
                    .limit(page_size)
                    .offset(offset);
            }
        }

        return {
            data: records,
            summary: summary, // Added summary totals
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
    static async getSummary(workspaceId, filters = {}) {
        const { period, year, date_from, date_to, column_filters, search } = filters;

        let cf = column_filters;
        if (cf && typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch (e) { cf = null; }
        }
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

            // Advanced filters
            BookDataModel._applyAdvancedFilters(q, filters, {
                gstin: 'si.customer_gstin',
                party: 'si.customer_name',
                is_interstate: 'si.is_interstate',
                roundoff: 'si.round_off',
                taxableAmt: 'si.total_taxable_value',
                totalAmt: 'si.total_invoice_value',
                placeOfSupply: 'si.place_of_supply'
            });

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

            // Column filters for summary (Sales)
            if (cf) {
                const colMappingSales = {
                    invoiceNo: 'si.invoice_number',
                    date: 'si.invoice_date',
                    party: 'si.customer_name',
                    gstin: 'si.customer_gstin',
                    taxableAmt: 'si.total_taxable_value',
                    igst: 'si.total_igst',
                    cgst: 'si.total_cgst',
                    sgst: 'si.total_sgst',
                    cess: 'si.total_cess',
                    totalAmt: 'si.total_invoice_value',
                    net: 'si.total_invoice_value',
                    roundOff: 'si.round_off',
                    status: 'si.filing_status',
                    docType: 'si.invoice_type',
                    gstType: knex.raw("UPPER(COALESCE(si.invoice_type, 'NONGST'))"),
                    placeOfSupply: 'si.place_of_supply'
                };
                BookDataModel._applyColumnFilters(q, cf, colMappingSales);
            }

            if (search) {
                q = q.where(function () {
                    this.where('si.invoice_number', 'ilike', `%${search}%`)
                        .orWhere('si.customer_name', 'ilike', `%${search}%`)
                        .orWhere('si.customer_gstin', 'ilike', `%${search}%`);
                });
            }

            const [row] = await q.select(
                knex.raw('COUNT(*) as total'),
                knex.raw('COALESCE(SUM(si.total_taxable_value),0) as taxable'),
                knex.raw('COALESCE(SUM(si.total_igst),0) as igst'),
                knex.raw('COALESCE(SUM(si.total_cgst),0) as cgst'),
                knex.raw('COALESCE(SUM(si.total_sgst),0) as sgst'),
                knex.raw('COALESCE(SUM(si.total_cess),0) as cess'),
                knex.raw('COALESCE(SUM(si.round_off),0) as round_off'),
                knex.raw('COALESCE(SUM(si.total_invoice_value),0) as invoice_value')
            );
            salesResults[t.id] = {
                total: parseInt(row.total),
                taxable: parseFloat(row.taxable),
                igst: parseFloat(row.igst),
                cgst: parseFloat(row.cgst),
                sgst: parseFloat(row.sgst),
                cess: parseFloat(row.cess),
                roundOff: parseFloat(row.round_off),
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
            let q = knex('purchase_vouchers as ev')
                .leftJoin('purchase_items as pi', 'ev.id', 'pi.purchase_id')
                .where('ev.workspace_id', workspaceId);
            if (t.voucherTypes) q = q.whereIn('ev.voucher_type', t.voucherTypes);
            if (t.bookTypes) q = q.whereIn('ev.book_type', t.bookTypes);

            // Advanced filters
            BookDataModel._applyAdvancedFilters(q, filters, {
                gstin: 'ev.supplier_gstin',
                party: 'ev.supplier_name',
                is_interstate: 'ev.is_interstate',
                roundoff: 'ev.round_off',
                taxableAmt: 'pi.taxable_amount',
                totalAmt: 'pi.row_total',
                row_total: 'pi.row_total',
                invoice_amount: 'pi.invoice_amount',
                placeOfSupply: 'ev.place_of_supply'
            });

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

            // Column filters for summary (Purchase)
            if (cf) {
                const colMappingPr = {
                    invoiceNo: 'ev.supplier_invoice_no',
                    ref_vchr_no: 'ev.supplier_invoice_no',
                    bookVchrNo: 'ev.book_vchr_no',
                    date: 'ev.supplier_invoice_date',
                    ref_vchr_date: 'ev.supplier_invoice_date',
                    bookVchrDate: 'ev.book_vchr_date',
                    party: 'ev.supplier_name',
                    gstin: 'ev.supplier_gstin',
                    taxableAmt: 'pi.taxable_amount',
                    igst: 'pi.igst_amount',
                    cgst: 'pi.cgst_amount',
                    sgst: 'pi.sgst_amount',
                    cess: 'pi.cess_amount',
                    totalAmt: 'pi.row_total',
                    row_total: 'pi.row_total',
                    net: 'pi.row_total',
                    invoice_amount: 'pi.invoice_amount',
                    roundOff: 'ev.round_off',
                    status: 'ev.status',
                    docType: 'ev.book_type',
                    vchType: 'ev.voucher_type',
                    gstType: knex.raw("COALESCE(NULLIF(UPPER(ev.source_section), 'EXPENSE'), NULLIF(UPPER(ev.voucher_type), 'EXPENSE'), 'NONGST')"),
                    placeOfSupply: 'ev.place_of_supply'
                };
                BookDataModel._applyColumnFilters(q, cf, colMappingPr);
            }

            if (search) {
                q = q.where(function () {
                    this.where('ev.supplier_invoice_no', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_name', 'ilike', `%${search}%`)
                        .orWhere('ev.supplier_gstin', 'ilike', `%${search}%`);
                });
            }

            const [row] = await q.select(
                knex.raw('COUNT(*) as total'),
                knex.raw('COALESCE(SUM(pi.taxable_amount),0) as taxable'),
                knex.raw('COALESCE(SUM(pi.igst_amount),0) as igst'),
                knex.raw('COALESCE(SUM(pi.cgst_amount),0) as cgst'),
                knex.raw('COALESCE(SUM(pi.sgst_amount),0) as sgst'),
                knex.raw('COALESCE(SUM(pi.cess_amount),0) as cess'),
                knex.raw('COALESCE(SUM(ev.round_off),0) as round_off'),
                knex.raw('COALESCE(SUM(pi.row_total),0) as invoice_value')
            );
            purchaseResults[t.id] = {
                total: parseInt(row.total),
                taxable: parseFloat(row.taxable),
                igst: parseFloat(row.igst),
                cgst: parseFloat(row.cgst),
                sgst: parseFloat(row.sgst),
                cess: parseFloat(row.cess),
                roundOff: parseFloat(row.round_off),
                invoiceValue: parseFloat(row.invoice_value)
            };
        }

        const allTypeSummary = { ...salesResults, ...purchaseResults };

        // Calculate Category-level Aggregates (useful for the new Purchase/Sales Listing pages)
        const purchaseAgg = Object.values(purchaseResults).reduce((acc, curr) => ({
            total: (acc.total || 0) + (curr.total || 0),
            taxable: (acc.taxable || 0) + (curr.taxable || 0),
            igst: (acc.igst || 0) + (curr.igst || 0),
            cgst: (acc.cgst || 0) + (curr.cgst || 0),
            sgst: (acc.sgst || 0) + (curr.sgst || 0),
            cess: (acc.cess || 0) + (curr.cess || 0),
            roundOff: (acc.roundOff || 0) + (curr.roundOff || 0),
            invoiceValue: (acc.invoiceValue || 0) + (curr.invoiceValue || 0)
        }), {});

        const salesAgg = Object.values(salesResults).reduce((acc, curr) => ({
            total: (acc.total || 0) + (curr.total || 0),
            taxable: (acc.taxable || 0) + (curr.taxable || 0),
            igst: (acc.igst || 0) + (curr.igst || 0),
            cgst: (acc.cgst || 0) + (curr.cgst || 0),
            sgst: (acc.sgst || 0) + (curr.sgst || 0),
            cess: (acc.cess || 0) + (curr.cess || 0),
            roundOff: (acc.roundOff || 0) + (curr.roundOff || 0),
            invoiceValue: (acc.invoiceValue || 0) + (curr.invoiceValue || 0)
        }), {});

        return { ...allTypeSummary, aggregated: purchaseAgg, salesAgg };
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
            const items = await knex('purchase_items')
                .where('purchase_id', id)
                .orderBy('id', 'asc');
            record.items = items;
            return record;
        }

        // Check sales_invoices
        record = await knex('sales_invoices')
            .where({ id, workspace_id: workspaceId })
            .first();

        if (record) {
            const items = await knex('sales_invoice_items')
                .where('sales_id', id)
                .orderBy('id', 'asc');
            record.items = items;
            return record;
        }

        return null;
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

        const is2a = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(filters.run_type);
        const statusTable = is2a ? 'reconciliation_status_gst2a_vs_book' : 'reconciliation_status';

        // Select fields aliased for frontend consistency
        query = query.leftJoin(`${statusTable} as rs`, 'pi.id', 'rs.book_data_id')
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

    /**
     * getMasters - fetches unique GSTINs and Party Names for multi-select filters.
     */
    static async getMasters(workspaceId, bookTypeId) {
        const resolved = BookDataModel._resolveMultipleTypes(bookTypeId);
        if (!resolved) throw new Error(`Unknown or mismatched book types: ${bookTypeId}`);

        if (resolved.table === 'sales') {
            const applyTypeFilters = (q) => {
                q.where(function () {
                    resolved.types.forEach(t => {
                        this.orWhere(function () {
                            if (t.invoiceTypes) this.whereIn('invoice_type', t.invoiceTypes);
                            if (t.bookTypes) this.whereIn('book_type', t.bookTypes);
                        });
                    });
                });
            };

            let qGstins = knex('sales_invoices')
                .where('workspace_id', workspaceId)
                .whereNotNull('customer_gstin')
                .whereNot('customer_gstin', '');
            applyTypeFilters(qGstins);
            qGstins = qGstins.select(knex.raw('DISTINCT trim(customer_gstin) as value'), knex.raw('trim(customer_gstin) as label'))
                .orderBy('value', 'asc');

            let qParties = knex('sales_invoices')
                .where('workspace_id', workspaceId)
                .whereNotNull('customer_name')
                .whereNot('customer_name', '');
            applyTypeFilters(qParties);
            qParties = qParties.select(knex.raw('DISTINCT customer_name as value'), knex.raw('customer_name as label'))
                .orderBy('value', 'asc');

            const [gstins, parties] = await Promise.all([qGstins, qParties]);
            return { gstins, parties };
        } else {
            const applyTypeFilters = (q) => {
                q.where(function () {
                    resolved.types.forEach(t => {
                        this.orWhere(function () {
                            if (t.voucherTypes) this.whereIn('voucher_type', t.voucherTypes);
                            if (t.bookTypes) this.whereIn('book_type', t.bookTypes);
                        });
                    });
                });
            };

            let qGstins = knex('purchase_vouchers')
                .where('workspace_id', workspaceId)
                .whereNotNull('supplier_gstin')
                .whereNot('supplier_gstin', '');
            applyTypeFilters(qGstins);
            qGstins = qGstins.select(knex.raw('DISTINCT trim(supplier_gstin) as value'), knex.raw('trim(supplier_gstin) as label'))
                .orderBy('value', 'asc');

            let qParties = knex('purchase_vouchers')
                .where('workspace_id', workspaceId)
                .whereNotNull('supplier_name')
                .whereNot('supplier_name', '');
            applyTypeFilters(qParties);
            qParties = qParties.select(knex.raw('DISTINCT supplier_name as value'), knex.raw('supplier_name as label'))
                .orderBy('value', 'asc');

            const [gstins, parties] = await Promise.all([qGstins, qParties]);
            return { gstins, parties };
        }
    }

    static async deleteById(workspaceId, id, tenantId, ipAddress, user, remark, itemId = null) {
        // 1. Retrieve the voucher/invoice details first
        let isPurchase = true;
        let record = await knex('purchase_vouchers')
            .where({ id, workspace_id: workspaceId })
            .first();

        // If not found in purchase_vouchers, try sales_invoices
        if (!record) {
            isPurchase = false;
            record = await knex('sales_invoices')
                .where({ id, workspace_id: workspaceId })
                .first();
        }

        if (!record) {
            throw new Error('Invoice or Voucher not found');
        }

        // 2. Determine the target item(s) to delete
        //    - If itemId is provided, only delete that specific line item
        //    - Otherwise delete the entire voucher and all its items
        let itemsToArchive = [];
        let deleteSingleItem = false;
        let shouldDeleteParent = false;

        if (isPurchase) {
            const allItems = await knex('purchase_items')
                .where('purchase_id', id)
                .orderBy('id', 'asc');

            if (itemId) {
                // Single-item deletion
                const targetItem = allItems.find(i => i.id === itemId);
                if (!targetItem) throw new Error('Line item not found for this voucher');
                itemsToArchive = [targetItem];
                deleteSingleItem = true;
                // Delete parent voucher only if this is the last item
                shouldDeleteParent = allItems.length === 1;
            } else {
                // Full voucher deletion — archive all items
                itemsToArchive = allItems;
                shouldDeleteParent = true;
            }
        } else {
            // Sales invoices: always full delete (no item_id support yet)
            itemsToArchive = await knex('sales_invoice_items')
                .where('sales_id', id)
                .orderBy('id', 'asc');
            shouldDeleteParent = true;
        }

        // 3. Determine type and subtype
        const type = 'book data';
        let subtype = 'purchase';
        if (isPurchase) {
            const vType = String(record.voucher_type || '').toLowerCase();
            if (vType.includes('credit')) subtype = 'credit note';
            else if (vType.includes('debit')) subtype = 'debit note';
            else if (vType.includes('expense')) subtype = 'expense';
        } else {
            const iType = String(record.invoice_type || '').toLowerCase();
            if (iType.includes('credit')) subtype = 'credit note';
            else if (iType.includes('debit')) subtype = 'debit note';
            else subtype = 'sales';
        }

        const refTableInfo = {
            parent_table: isPurchase ? 'purchase_vouchers' : 'sales_invoices',
            child_table: isPurchase ? 'purchase_items' : 'sales_invoice_items',
            child_fk_column: isPurchase ? 'purchase_id' : 'sales_id',
            deleted_item_id: itemId || null,
            deletion_mode: deleteSingleItem ? 'single_item' : 'full_voucher'
        };

        const extraInfo = {
            deleted_by: {
                id: user?.id || user?.sub || null,
                name: user?.full_name || user?.name || null,
                email: user?.email || null
            }
        };

        const vchr_no = isPurchase ? record.book_vchr_no : record.invoice_number;
        const vchr_date = isPurchase ? record.book_vchr_date : record.invoice_date;
        const inv_no = isPurchase ? record.supplier_invoice_no : record.invoice_number;
        const inv_date = isPurchase ? record.supplier_invoice_date : record.invoice_date;

        // 4. Execute database operations inside a transaction
        await knex.transaction(async (trx) => {
            // A. Archive to deleted_invoices
            await trx('deleted_invoices').insert({
                type,
                subtype,
                tenant_id: tenantId,
                workspace_id: workspaceId,
                user_id: user?.db_id || user?.id || user?.sub || null,
                main_data: JSON.stringify(record),
                line_items: JSON.stringify(itemsToArchive),
                ref_table_info: JSON.stringify(refTableInfo),
                vchr_no,
                vchr_date,
                inv_no,
                inv_date,
                ip_address: ipAddress,
                remark: remark || `Deleted by ${user?.full_name || user?.email || 'User'}`,
                t_extra_info: JSON.stringify(extraInfo)
            });

            if (isPurchase) {
                if (deleteSingleItem) {
                    // B1. Delete only the specific purchase_items row
                    await trx('purchase_items').where('id', itemId).delete();

                    // B2. If this was the last item, clean up the parent voucher too
                    if (shouldDeleteParent) {
                        await trx('reconciliation_results').where('purchase_invoice_id', id).delete();
                        await trx('reconciliation_results_2a').where('purchase_invoice_id', id).delete();
                        await trx('reconciliation_status_gst2a_vs_book').where('book_data_id', id).delete();
                        await trx('reconciliation_status').where('book_data_id', id).delete();
                        await trx('purchase_vouchers').where('id', id).delete();
                    }
                } else {
                    // B3. Full voucher deletion — remove all dependencies then parent
                    await trx('reconciliation_results').where('purchase_invoice_id', id).delete();
                    await trx('reconciliation_results_2a').where('purchase_invoice_id', id).delete();
                    await trx('reconciliation_status_gst2a_vs_book').where('book_data_id', id).delete();
                    await trx('reconciliation_status').where('book_data_id', id).delete();
                    await trx('purchase_items').where('purchase_id', id).delete();
                    await trx('purchase_vouchers').where('id', id).delete();
                }
            } else {
                // Sales: always full delete
                await trx('sales_invoice_items').where('sales_id', id).delete();
                await trx('sales_invoices').where('id', id).delete();
            }
        });

        return { id, itemId, type, subtype, deletionMode: deleteSingleItem ? 'single_item' : 'full_voucher' };
    }

    static async getDeletedInvoices(workspaceId, { type, subtype, search, page = 1, page_size = 50 }) {
        let query = knex('deleted_invoices')
            .where('workspace_id', workspaceId);

        if (type) {
            query = query.where('type', type);
        }
        if (subtype) {
            query = query.where('subtype', subtype);
        }
        if (search) {
            const searchLower = search.toLowerCase();
            query = query.where(function() {
                this.whereRaw('LOWER(vchr_no) LIKE ?', [`%${searchLower}%`])
                    .orWhereRaw('LOWER(inv_no) LIKE ?', [`%${searchLower}%`])
                    .orWhereRaw('LOWER(remark) LIKE ?', [`%${searchLower}%`])
                    .orWhereRaw('LOWER(subtype) LIKE ?', [`%${searchLower}%`]);
            });
        }

        const countQuery = query.clone().clearSelect().clearOrder().count('id as count').first();
        const totalResult = await countQuery;
        const total = parseInt(totalResult?.count || 0, 10);

        const rows = await query
            .clone()
            .leftJoin('users', 'deleted_invoices.user_id', 'users.id')
            .select(
                'deleted_invoices.*',
                'users.full_name as user_full_name',
                'users.email as user_email'
            )
            .orderBy('deleted_invoices.deleted_at', 'desc')
            .offset((page - 1) * page_size)
            .limit(page_size);

        return {
            total,
            page,
            page_size,
            data: rows
        };
    }
}

module.exports = BookDataModel;


