const knex = require('../../../shared/src/db/connection');

class DashboardModel {
    /**
     * Gets aggregated dashboard metrics for the given workspace focusing on Purchase and GSTR data.
     */
    static async getMetrics(workspaceId, financialYear) {
        // 0. Detect Context (Reference Date)
        let referenceDate = new Date();
        let fyStartDate = null;

        if (financialYear && financialYear !== 'all') {
            // If year is provided (e.g., "2024-25"), we set referenceDate to the end of that FY (March 31 of next year)
            const startYear = parseInt(financialYear.split('-')[0], 10);
            fyStartDate = `${startYear}-04-01`;
            // For reference date, we take the LATEST date within that FY from data, 
            // or default to March 31 of the next year if it's a past FY.
            const endYear = startYear + 1;
            const absoluteMaxFyDate = new Date(endYear, 2, 31); // March 31

            const latestInFy = await knex('purchase_vouchers')
                .where({ workspace_id: workspaceId })
                .where('book_vchr_date', '>=', fyStartDate)
                .where('book_vchr_date', '<=', `${endYear}-03-31`)
                .orderBy('book_vchr_date', 'desc')
                .first('book_vchr_date');

            if (latestInFy?.book_vchr_date) {
                referenceDate = new Date(latestInFy.book_vchr_date);
            } else {
                referenceDate = absoluteMaxFyDate;
            }
        } else {
            // Detect Absolute Latest Data Month to set context (WITHOUT any date filters first)
            const latestPurchase = await knex('purchase_vouchers')
                .where({ workspace_id: workspaceId })
                .orderBy('book_vchr_date', 'desc')
                .first('book_vchr_date');

            const latestGstr = await knex('normalized_gstr2b_invoices')
                .where({ workspace_id: workspaceId })
                .orderBy('return_period', 'desc')
                .first('return_period');

            if (latestPurchase?.book_vchr_date) referenceDate = new Date(latestPurchase.book_vchr_date);
            if (latestGstr?.return_period) {
                const rp = latestGstr.return_period;
                const gDate = new Date(parseInt(rp.substring(2, 6)), parseInt(rp.substring(0, 2)) - 1, 1);
                if (gDate > referenceDate) referenceDate = gDate;
            }

            const fyStartYear = referenceDate.getMonth() >= 3 ? referenceDate.getFullYear() : referenceDate.getFullYear() - 1;
            fyStartDate = `${fyStartYear}-04-01`;
        }

        // Calculate all 12 months of the Financial Year (April to March)
        const fyStartYear = new Date(fyStartDate).getFullYear();
        const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(fyStartYear, 3 + i, 1); // Start from April (Month 3 in JS)
            return {
                label: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
                yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            };
        });

        const latestDataMonth = months[months.length - 1].yearMonth;

        // 1. Purchase Book Data (Register)
        let purchaseQuery = knex('purchase_vouchers')
            .select(
                knex.raw(`to_char(book_vchr_date, 'YYYY-MM') as month`),
                knex.raw('SUM(COALESCE(taxable_total, 0)) as taxable'),
                knex.raw('COUNT(*) as count'),
                knex.raw('SUM(COALESCE(total_igst_amount, 0) + COALESCE(total_cgst_amount, 0) + COALESCE(total_sgst_amount, 0) + COALESCE(total_cess_amount, 0)) as tax'),
                knex.raw('SUM(COALESCE(net_amount, 0)) as invoice_value')
            )
            .where({ workspace_id: workspaceId })
            .whereNotIn('gstr_category', ['RDB2C', 'NONGST', 'RDB2CL']);

        if (financialYear && financialYear !== 'all') {
            purchaseQuery = purchaseQuery.where('book_vchr_date', '>=', fyStartDate);
            const endYear = parseInt(financialYear.split('-')[0], 10) + 1;
            purchaseQuery = purchaseQuery.where('book_vchr_date', '<=', `${endYear}-03-31`);
        } else if (!financialYear || financialYear === 'all') {
            // Default to filtering from current FY if no year selected, 
            // BUT if 'all' is explicitly requested, we might want to skip it.
            // Let's keep a loose filter for performance or skip if 'all'
            if (financialYear !== 'all') purchaseQuery = purchaseQuery.where('book_vchr_date', '>=', fyStartDate);
        }

        const purchaseData = await purchaseQuery.groupByRaw(`to_char(book_vchr_date, 'YYYY-MM')`);

        // 2. GSTR-2B Portal Data (Aggregated by Invoice Date)
        let portalQuery = knex('normalized_gstr2b_invoices')
            .select(
                knex.raw(`to_char(document_date, 'YYYY-MM') as month`),
                knex.raw('SUM(COALESCE(taxable_value, 0)) as taxable'),
                knex.raw('COUNT(*) as count'),
                knex.raw('SUM(COALESCE(igst, 0) + COALESCE(cgst, 0) + COALESCE(sgst, 0) + COALESCE(cess, 0)) as tax'),
                knex.raw('SUM(COALESCE(document_value, 0)) as invoice_value')
            )
            .where({ workspace_id: workspaceId });

        if (financialYear && financialYear !== 'all') {
            portalQuery = portalQuery.where('document_date', '>=', fyStartDate);
            const endYear = parseInt(financialYear.split('-')[0], 10) + 1;
            portalQuery = portalQuery.where('document_date', '<=', `${endYear}-03-31`);
        } else if (!financialYear || financialYear === 'all') {
            if (financialYear !== 'all') portalQuery = portalQuery.where('document_date', '>=', fyStartDate);
        }

        const portalData = await portalQuery.groupByRaw(`to_char(document_date, 'YYYY-MM')`);

        // Process YTD metrics
        let ytdBooksPurchases = 0, ytdPortalPurchases = 0, ytdBooksTax = 0, ytdPortalTax = 0;

        purchaseData.forEach(row => {
            ytdBooksPurchases += Number(row.taxable) || 0;
            ytdBooksTax += Number(row.tax) || 0;
        });

        portalData.forEach(row => {
            ytdPortalPurchases += Number(row.taxable) || 0;
            ytdPortalTax += Number(row.tax) || 0;
        });

        const isYearView = financialYear && financialYear !== 'all';
        const currentYear = referenceDate.getFullYear();
        const currentMonthIndex = referenceDate.getMonth();
        const prevDataDate = new Date(currentYear, currentMonthIndex - 1, 1);
        const previousMonthYMString = `${prevDataDate.getFullYear()}-${String(prevDataDate.getMonth() + 1).padStart(2, '0')}`;

        // Process Current Month metrics
        const currentBooksMonth = purchaseData.find(r => r.month === latestDataMonth);
        const currentPortalMonth = portalData.find(r => r.month === latestDataMonth);
        const prevBooksMonth = purchaseData.find(r => r.month === previousMonthYMString);

        const currentBooksTaxable = Number(currentBooksMonth?.taxable || 0);
        const prevBooksTaxable = Number(prevBooksMonth?.taxable || 0);

        let purchaseGrowth = 0;
        if (prevBooksTaxable > 0) {
            purchaseGrowth = ((currentBooksTaxable - prevBooksTaxable) / prevBooksTaxable) * 100;
        } else if (currentBooksTaxable > 0) {
            purchaseGrowth = 100;
        }

        // Label: If year is selected, show FY. If not, show "YTD (Current Month Name)"
        const currentMonthLabel = isYearView ? `FY ${financialYear}` : `YTD (${referenceDate.toLocaleString('default', { month: 'long', year: 'numeric' })})`;
        const netPayableDueMonth = new Date(currentYear, currentMonthIndex + 1, 20);
        const netPayableDueDate = netPayableDueMonth.toLocaleString('en-GB', { day: 'numeric', month: 'short' });

        const currentMonth = {
            // We now show YTD by default in the main KPI cards to ensure all imported data is visible
            booksPurchases: ytdBooksPurchases,
            portalPurchases: ytdPortalPurchases,
            booksTax: ytdBooksTax,
            portalTax: ytdPortalTax,
            variance: ytdBooksTax - ytdPortalTax,
            purchaseGrowth: purchaseGrowth,
            currentMonthLabel: currentMonthLabel,
            netPayableDueDate: netPayableDueDate,
            transactionCount: purchaseData.reduce((s, r) => s + Number(r.count), 0),
            avgInvoiceValue: 0
        };

        currentMonth.avgInvoiceValue = currentMonth.transactionCount > 0 ? (currentMonth.booksPurchases / currentMonth.transactionCount) : 0;

        const yearToDate = {
            booksPurchases: ytdBooksPurchases,
            portalPurchases: ytdPortalPurchases,
            booksTax: ytdBooksTax,
            portalTax: ytdPortalTax
        };

        // Monthly Trend for the last 5 months (Books vs Portal)
        const monthlyTrend = months.map(m => {
            const bData = purchaseData.find(d => d.month === m.yearMonth);
            const pData = portalData.find(d => d.month === m.yearMonth);
            return {
                month: m.label,
                books: Number(bData?.taxable || 0),
                portal: Number(pData?.taxable || 0),
                booksTax: Number(bData?.tax || 0),
                portalTax: Number(pData?.tax || 0)
            };
        });

        // 3. Tax Head Breakdown (Current Month or YTD)
        const taxBreakdown = {
            igst: { portal: 0, books: 0 },
            cgst: { portal: 0, books: 0 },
            sgst: { portal: 0, books: 0 },
            cess: { portal: 0, books: 0 }
        };

        // For tax breakdown
        let portalTaxQuery = knex('normalized_gstr2b_invoices').where({ workspace_id: workspaceId });
        let booksTaxQuery = knex('purchase_vouchers')
            .where({ workspace_id: workspaceId })
            .whereNotIn('gstr_category', ['RDB2C', 'NONGST', 'RDB2CL']);

        if (financialYear && financialYear !== 'all') {
            portalTaxQuery = portalTaxQuery.where('document_date', '>=', fyStartDate);
            const endYear = parseInt(financialYear.split('-')[0], 10) + 1;
            portalTaxQuery = portalTaxQuery.where('document_date', '<=', `${endYear}-03-31`);

            booksTaxQuery = booksTaxQuery.where('book_vchr_date', '>=', fyStartDate).where('book_vchr_date', '<=', `${endYear}-03-31`);
        } else if (!financialYear) {
            // Default: Latest Month (based on invoice date now)
            portalTaxQuery = portalTaxQuery.whereRaw(`to_char(document_date, 'YYYY-MM') = ?`, [latestDataMonth]);
            booksTaxQuery = booksTaxQuery.whereRaw(`to_char(book_vchr_date, 'YYYY-MM') = ?`, [latestDataMonth]);
        }
        // Note: If financialYear === 'all', we don't add date filters, getting the cumulative breakdown.

        const portalTaxResult = await portalTaxQuery.select(
            knex.raw('SUM(COALESCE(igst, 0)) as igst'),
            knex.raw('SUM(COALESCE(cgst, 0)) as cgst'),
            knex.raw('SUM(COALESCE(sgst, 0)) as sgst'),
            knex.raw('SUM(COALESCE(cess, 0)) as cess')
        ).first();

        const booksTaxResult = await booksTaxQuery.select(
            knex.raw('SUM(COALESCE(total_igst_amount, 0)) as igst'),
            knex.raw('SUM(COALESCE(total_cgst_amount, 0)) as cgst'),
            knex.raw('SUM(COALESCE(total_sgst_amount, 0)) as sgst'),
            knex.raw('SUM(COALESCE(total_cess_amount, 0)) as cess')
        ).first();

        if (portalTaxResult) {
            taxBreakdown.igst.portal = parseFloat(portalTaxResult.igst || 0);
            taxBreakdown.cgst.portal = parseFloat(portalTaxResult.cgst || 0);
            taxBreakdown.sgst.portal = parseFloat(portalTaxResult.sgst || 0);
            taxBreakdown.cess.portal = parseFloat(portalTaxResult.cess || 0);
        }

        if (booksTaxResult) {
            taxBreakdown.igst.books = parseFloat(booksTaxResult.igst || 0);
            taxBreakdown.cgst.books = parseFloat(booksTaxResult.cgst || 0);
            taxBreakdown.sgst.books = parseFloat(booksTaxResult.sgst || 0);
            taxBreakdown.cess.books = parseFloat(booksTaxResult.cess || 0);
        }

        // 4. Compliance & Activities
        const recentImports = await knex('gstr_import_master')
            .where({ workspace_id: workspaceId })
            .whereIn('import_type', ['GSTR2A', 'GSTR2B', 'PURCHASE_REGISTER'])
            .orderBy('upload_timestamp', 'desc')
            .limit(10);

        const activities = recentImports.map(item => ({
            action: `${item.import_type?.replace('_', ' ')} Import`,
            date: new Date(item.upload_timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            status: item.status?.toLowerCase() === 'completed' ? 'success' : 'pending',
            details: item.original_filename || 'System Import'
        }));

        // 5. Reconciliation Stats (Latest Run)
        const latestRun = await knex('reconciliation_runs')
            .where({ workspace_id: workspaceId, status: 'COMPLETED' })
            .orderBy('created_at', 'desc')
            .first();

        const is2aVs2b = latestRun && ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(latestRun.run_type);

        let reconciliation = {
            summary: { matched: 0, mismatched: 0, missing_in_portal: 0, missing_in_books: 0, total: 0 },
            variance: 0,
            accuracy: 0
        };

        if (latestRun) {
            const resultsTable = is2aVs2b ? 'reconciliation_results_2a' : 'reconciliation_results';
            const stats = await knex(resultsTable)
                .where({ recon_run_id: latestRun.id })
                .select('match_status')
                .count('* as count')
                .sum('variance_amount as variance')
                .groupBy('match_status');

            stats.forEach(s => {
                const status = s.match_status?.toLowerCase();
                if (status === 'matched') reconciliation.summary.matched = parseInt(s.count);
                else if (status === 'mismatched' || status === 'partial_match') reconciliation.summary.mismatched += parseInt(s.count);
                else if (status.includes('portal')) reconciliation.summary.missing_in_portal = parseInt(s.count);
                else if (status.includes('books')) reconciliation.summary.missing_in_books = parseInt(s.count);

                reconciliation.summary.total += parseInt(s.count);
                reconciliation.variance += parseFloat(s.variance || 0);
            });
            reconciliation.accuracy = reconciliation.summary.total > 0 ? (reconciliation.summary.matched / reconciliation.summary.total) * 100 : 0;
        }

        // 6. Transaction Categories Breakdown
        let transactionCategories = [];
        if (latestRun) {
            const resultsTable = is2aVs2b ? 'reconciliation_results_2a' : 'reconciliation_results';
            const gstrTable = is2aVs2b ? 'normalized_gstr2a_invoices' : 'normalized_gstr2b_invoices';
            const gstrIdCol = is2aVs2b ? 'gstr2a_invoice_id' : 'gstr2b_invoice_id';

            const categoryStats = await knex(resultsTable)
                .join(gstrTable, `${resultsTable}.${gstrIdCol}`, `${gstrTable}.id`)
                .where(`${resultsTable}.recon_run_id`, latestRun.id)
                .select(`${gstrTable}.document_category`, `${gstrTable}.source_section`, `${resultsTable}.match_status`)
                .count('* as count')
                .groupBy(`${gstrTable}.document_category`, `${gstrTable}.source_section`, `${resultsTable}.match_status`);

            const categories = {
                'B2B': { total: 0, matched: 0 },
                'B2BA': { total: 0, matched: 0 },
                'Credit Note': { total: 0, matched: 0 },
                'Debit Note': { total: 0, matched: 0 }
            };

            categoryStats.forEach(s => {
                let label = null;
                if (s.source_section === 'B2B') label = 'B2B';
                else if (s.source_section === 'B2BA') label = 'B2BA';
                else if (s.document_category === 'CREDIT_NOTE') label = 'Credit Note';
                else if (s.document_category === 'DEBIT_NOTE') label = 'Debit Note';

                if (label && categories[label]) {
                    const count = parseInt(s.count);
                    categories[label].total += count;
                    if (s.match_status?.toLowerCase() === 'matched') {
                        categories[label].matched += count;
                    }
                }
            });

            transactionCategories = Object.entries(categories).map(([name, stats]) => ({
                name,
                total: stats.total,
                matched: stats.matched,
                percentage: stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0
            }));
        }

        // 7. Purchase Categories Breakdown (Pie Chart Data)
        let purchaseCatQuery = knex('purchase_vouchers')
            .select(
                knex.raw("COALESCE(voucher_type, 'Others') as type"),
                knex.raw('COUNT(*) as count'),
                knex.raw('SUM(COALESCE(taxable_total, 0)) as total')
            )
            .where({ workspace_id: workspaceId })
            .whereNotIn('gstr_category', ['RDB2C', 'NONGST', 'RDB2CL']);

        if (financialYear && financialYear !== 'all') {
            purchaseCatQuery = purchaseCatQuery.where('book_vchr_date', '>=', fyStartDate);
            const endYear = parseInt(financialYear.split('-')[0], 10) + 1;
            purchaseCatQuery = purchaseCatQuery.where('book_vchr_date', '<=', `${endYear}-03-31`);
        } else if (!financialYear) {
            // Default: Latest Month
            purchaseCatQuery = purchaseCatQuery.whereRaw(`to_char(book_vchr_date, 'YYYY-MM') = ?`, [latestDataMonth]);
        }

        const purchaseCategories = await purchaseCatQuery.groupByRaw("COALESCE(voucher_type, 'Others')");

        // 8. Data Availability (Quarterly)
        const currentFyStartYear = parseInt(fyStartDate.substring(0, 4));
        const quarters = [
            { name: 'Q4', months: ['01', '02', '03'], year: currentFyStartYear + 1 },
            { name: 'Q3', months: ['10', '11', '12'], year: currentFyStartYear },
            { name: 'Q2', months: ['07', '08', '09'], year: currentFyStartYear },
            { name: 'Q1', months: ['04', '05', '06'], year: currentFyStartYear }
        ];

        // 8. Data Availability (Quarterly) - Based on Actual Data
        const dataAvailability = quarters.map(q => {
            const qMonths = q.months.map(m => `${q.year}-${m}`);

            const hasBooks = purchaseData.some(row => qMonths.includes(row.month));
            const hasPortal = portalData.some(row => qMonths.includes(row.month));

            return {
                quarter: q.name,
                year: q.year,
                portalAvailable: hasPortal,
                booksAvailable: hasBooks,
                status: (hasPortal && hasBooks) ? 'available' : (hasPortal || hasBooks ? 'partial' : 'pending')
            };
        });

        // 9. Recent Updates
        const lastBookImport = await knex('gstr_import_master')
            .where({ workspace_id: workspaceId, import_type: 'PURCHASE_REGISTER', status: 'Completed' })
            .orderBy('upload_timestamp', 'desc')
            .first();

        const lastGstrImport = await knex('gstr_import_master')
            .where({ workspace_id: workspaceId, status: 'Completed' })
            .whereIn('import_type', ['GSTR2A', 'GSTR2B'])
            .orderBy('upload_timestamp', 'desc')
            .first();

        const recentUpdates = {
            books: lastBookImport ? {
                date: lastBookImport.upload_timestamp,
                filename: lastBookImport.original_filename,
                count: lastBookImport.total_record
            } : null,
            gstr: lastGstrImport ? {
                date: lastGstrImport.upload_timestamp,
                filename: lastGstrImport.original_filename,
                count: lastGstrImport.total_record,
                type: lastGstrImport.import_type
            } : null
        };

        // 10. Top Suppliers by Variance
        let topSuppliers = [];
        if (latestRun) {
            let suppliersQuery;
            if (is2aVs2b) {
                suppliersQuery = knex('reconciliation_results_2a')
                    .leftJoin('normalized_gstr2a_invoices as gi', 'reconciliation_results_2a.gstr2a_invoice_id', 'gi.id')
                    .leftJoin('normalized_gstr2b_invoices as gb', 'reconciliation_results_2a.gstr2b_invoice_id', 'gb.id')
                    .leftJoin('normalized_gstr2a_invoices as sa', 'reconciliation_results_2a.gstr2a_source_id', 'sa.id')
                    .where('reconciliation_results_2a.recon_run_id', latestRun.id);
            } else {
                suppliersQuery = knex('reconciliation_results')
                    .leftJoin('purchase_vouchers as pv', 'reconciliation_results.purchase_invoice_id', 'pv.id')
                    .leftJoin('normalized_gstr2b_invoices as gi', 'reconciliation_results.gstr2b_invoice_id', 'gi.id')
                    .where('reconciliation_results.recon_run_id', latestRun.id);
            }

            if (financialYear && financialYear !== 'all') {
                const startYear = parseInt(financialYear.split('-')[0], 10);
                const dateExpr = is2aVs2b 
                    ? `COALESCE(gi.document_date, gb.document_date, sa.document_date)`
                    : `COALESCE(pv.book_vchr_date, gi.document_date)`;
                suppliersQuery = suppliersQuery
                    .whereRaw(`${dateExpr} >= ?`, [`${startYear}-04-01`])
                    .whereRaw(`${dateExpr} <= ?`, [`${startYear + 1}-03-31`]);
            }

            const nameExpr = is2aVs2b
                ? 'COALESCE(gi.supplier_name, gb.supplier_name, sa.supplier_name)'
                : 'COALESCE(pv.supplier_name, gi.supplier_name)';

            const gstinExpr = is2aVs2b
                ? 'COALESCE(gi.supplier_gstin, gb.supplier_gstin, sa.supplier_gstin)'
                : 'COALESCE(pv.supplier_gstin, gi.supplier_gstin)';

            topSuppliers = await suppliersQuery
                .select(
                    knex.raw(`MAX(${nameExpr}) as supplier_name`),
                    knex.raw(`MAX(${gstinExpr}) as supplier_gstin`),
                    knex.raw('SUM(ABS(variance_amount)) as total_variance'),
                    knex.raw('COUNT(*) as invoice_count')
                )
                .groupByRaw(gstinExpr)
                .orderBy('total_variance', 'desc')
                .limit(5);
        }

        return {
            currentMonth,
            yearToDate,
            monthlyTrend,
            reconciliation,
            transactionCategories,
            purchaseCategories,
            dataAvailability,
            recentUpdates,
            taxBreakdown,
            topSuppliers,
            recentActivities: activities,
            compliance: { score: Math.round(reconciliation.accuracy) }
        };
    }

    static async getLatestPeriod(workspaceId) {
        const latestPurchase = await knex('purchase_vouchers')
            .where({ workspace_id: workspaceId })
            .orderBy('book_vchr_date', 'desc')
            .first('book_vchr_date');

        const latestGstr = await knex('normalized_gstr2b_invoices')
            .where({ workspace_id: workspaceId })
            .orderBy('return_period', 'desc')
            .first('return_period');

        let maxDate = null;
        if (latestPurchase?.book_vchr_date) maxDate = new Date(latestPurchase.book_vchr_date);
        if (latestGstr?.return_period) {
            const rp = latestGstr.return_period;
            const gDate = new Date(parseInt(rp.substring(2, 6)), parseInt(rp.substring(0, 2)) - 1, 1);
            if (!maxDate || gDate > maxDate) maxDate = gDate;
        }

        const date = maxDate || new Date();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return { period: `${mm}${yyyy}` };
    }

    static async getSidebarCounts(workspaceId) {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const importCounts = await knex('gstr_import_master')
            .where({ workspace_id: workspaceId })
            .where('upload_timestamp', '>=', sevenDaysAgo)
            .select('import_type')
            .count('* as count')
            .groupBy('import_type');

        const gstImportCount = importCounts
            .filter(i => ['GSTR2A', 'GSTR2B'].includes(i.import_type))
            .reduce((sum, i) => sum + parseInt(i.count), 0);

        const bookImportCount = importCounts
            .filter(i => ['PURCHASE_REGISTER'].includes(i.import_type))
            .reduce((sum, i) => sum + parseInt(i.count), 0);

        const reconCount = await knex('reconciliation_status')
            .where({ workspace_id: workspaceId, recon_status: 'pending' })
            .count('* as count')
            .first();

        return {
            book_import_count: bookImportCount || 0,
            gst_import_count: gstImportCount || 0,
            reconciliation_count: parseInt(reconCount?.count) || 0
        };
    }

    static async getFinancialYears() {
        return await knex('financial_years')
            .select('id', 'fy_code', 'display_name')
            .orderBy('fy_code', 'desc');
    }
}

module.exports = DashboardModel;
