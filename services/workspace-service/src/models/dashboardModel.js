const knex = require('../../../shared/src/db/connection');

class DashboardModel {
    /**
     * Gets aggregated dashboard metrics for the given workspace.
     */
    static async getMetrics(workspaceId) {
        // Calculate recent 5 months
        const months = Array.from({ length: 5 }, (_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            return {
                label: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
                yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            };
        }).reverse(); // Oldest to newest for the trend graph

        const currentMonthYM = months[months.length - 1].yearMonth;

        // Current FY Logic (April 1 to March 31)
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyStartDate = `${fyStartYear}-04-01`;

        // We fetch totals from sales_invoices and purchase_vouchers for the workspace

        // 1. Sales query
        const salesQuery = knex('sales_invoices')
            .where({ workspace_id: workspaceId })
            .whereIn('book_type', ['SI', 'CN-S', 'DN-S']); // Approximate sales types, filtering returns/notes properly could be complex depending on exact business logic, but total_taxable_value / total_invoice_value generally captures the positive amount. For CN, it's typically negative or handled separately. Assuming standard positive sums for now.
        // Actually, let's just sum across all sales types as per standard GST rules, 
        // CN reduces liability, DN increases it. We'll simplify to just sum all total_taxable_value.

        // Getting all relevant sales records for the FY
        const salesData = await knex('sales_invoices')
            .select(
                knex.raw(`to_char(invoice_date, 'YYYY-MM') as month`),
                knex.raw('SUM(total_taxable_value) as taxable'),
                knex.raw('COUNT(*) as count'),
                knex.raw('SUM(total_igst + total_cgst + total_sgst + total_cess) as tax'),
                knex.raw('SUM(total_invoice_value) as invoice_value')
            )
            .where({ workspace_id: workspaceId })
            .where('invoice_date', '>=', fyStartDate)
            .groupByRaw(`to_char(invoice_date, 'YYYY-MM')`);

        // Getting all relevant purchase records for the FY
        const purchaseData = await knex('purchase_vouchers')
            .select(
                knex.raw(`to_char(supplier_invoice_date, 'YYYY-MM') as month`),
                knex.raw('SUM(taxable_total) as taxable'),
                knex.raw('SUM(total_igst_amount + total_cgst_amount + total_sgst_amount + total_cess_amount) as tax'),
                knex.raw('SUM(net_amount) as invoice_value')
            )
            .where({ workspace_id: workspaceId })
            .where('supplier_invoice_date', '>=', fyStartDate)
            .groupByRaw(`to_char(supplier_invoice_date, 'YYYY-MM')`);

        // Process YTD metrics
        let ytdSales = 0, ytdPurchases = 0, ytdOutputTax = 0, ytdInputTax = 0;

        salesData.forEach(row => {
            ytdSales += Number(row.taxable) || 0;
            ytdOutputTax += Number(row.tax) || 0;
        });

        purchaseData.forEach(row => {
            ytdPurchases += Number(row.taxable) || 0;
            ytdInputTax += Number(row.tax) || 0;
        });

        // Determine the latest month with data
        let latestDataMonth = currentMonthYM;
        const allMonthsWithData = [
            ...salesData.map(r => r.month),
            ...purchaseData.map(r => r.month)
        ].sort().reverse();

        if (allMonthsWithData.length > 0) {
            latestDataMonth = allMonthsWithData[0];
        }

        let currentYear, currentMonthIndex;
        try {
            const parts = latestDataMonth.split('-');
            currentYear = parseInt(parts[0], 10);
            currentMonthIndex = parseInt(parts[1], 10) - 1;
        } catch (e) {
            const fallback = new Date();
            currentYear = fallback.getFullYear();
            currentMonthIndex = fallback.getMonth();
        }

        const dataDate = new Date(currentYear, currentMonthIndex, 1);
        const prevDataDate = new Date(currentYear, currentMonthIndex - 1, 1);
        const previousMonthYMString = `${prevDataDate.getFullYear()}-${String(prevDataDate.getMonth() + 1).padStart(2, '0')}`;

        // Process Current Month metrics
        const previousSalesMonth = salesData.find(r => r.month === previousMonthYMString);
        const previousSales = Number(previousSalesMonth?.taxable || 0);

        const currentSalesMonth = salesData.find(r => r.month === latestDataMonth);
        const currentPurchaseMonth = purchaseData.find(r => r.month === latestDataMonth);

        // Dynamic Growth Calculation
        const currentSales = Number(currentSalesMonth?.taxable || 0);
        let salesGrowth = 0;
        if (previousSales > 0) {
            salesGrowth = ((currentSales - previousSales) / previousSales) * 100;
        } else if (currentSales > 0) {
            salesGrowth = 100;
        }

        // Dynamic Labels and Dates
        const currentMonthLabel = dataDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        const netPayableDueMonth = new Date(currentYear, currentMonthIndex + 1, 20);
        const netPayableDueDate = netPayableDueMonth.toLocaleString('en-GB', { day: 'numeric', month: 'short' }); // e.g. "20 Dec"
        const previousMonthLabelName = prevDataDate.toLocaleString('default', { month: 'short' }); // e.g. "Oct"

        const transactionCount = Number(currentSalesMonth?.count || 0);
        const avgInvoiceValue = transactionCount > 0 ? (currentSales / transactionCount) : 0;

        const currentMonth = {
            sales: currentSales,
            purchases: Number(currentPurchaseMonth?.taxable || 0),
            outputTax: Number(currentSalesMonth?.tax || 0),
            inputTax: Number(currentPurchaseMonth?.tax || 0),
            netPayable: Math.max(0, Number(currentSalesMonth?.tax || 0) - Number(currentPurchaseMonth?.tax || 0)), // Simplified logic
            salesGrowth: salesGrowth,
            previousMonthLabelName: previousMonthLabelName,
            currentMonthLabel: currentMonthLabel,
            netPayableDueDate: netPayableDueDate,
            transactionCount,
            avgInvoiceValue
        };

        const yearToDate = {
            sales: ytdSales,
            purchases: ytdPurchases,
            outputTax: ytdOutputTax,
            inputTax: ytdInputTax,
            netPaid: Math.max(0, ytdOutputTax - ytdInputTax)
        };

        // Monthly Trend for the last 5 months
        const monthlyTrend = months.map(m => {
            const sData = salesData.find(d => d.month === m.yearMonth);
            return {
                month: m.label,
                sales: Number(sData?.taxable || 0),
                tax: Number(sData?.tax || 0)
            };
        });

        // Dynamic Compliance Score based on recent filings
        const recentImports = await knex('gstr_import_master')
            .where({ workspace_id: workspaceId })
            .whereIn('import_type', ['GSTR1', 'GSTR3B', 'GSTR2A', 'GSTR2B', 'SALES_REGISTER', 'PURCHASE_REGISTER', 'SALES_RETURN', 'PURCHASE_RETURN'])
            .orderBy('upload_timestamp', 'desc')
            .limit(20);

        let gstr1Status = 'pending';
        let gstr3bStatus = 'pending';
        let gstr2aStatus = 'pending';
        let complianceScore = 0;
        let lastFilingDate = null;

        if (recentImports.length > 0) {
            const latestGSTR1 = recentImports.find(i => i.import_type === 'GSTR1');
            const latestGSTR3B = recentImports.find(i => i.import_type === 'GSTR3B');
            const latestGSTR2A = recentImports.find(i => ['GSTR2A', 'GSTR2B'].includes(i.import_type));

            if (latestGSTR1) {
                gstr1Status = 'filed';
                complianceScore += 33.33;
                lastFilingDate = latestGSTR1.upload_timestamp;
            }
            if (latestGSTR3B) {
                gstr3bStatus = 'filed';
                complianceScore += 33.34;
                if (!lastFilingDate || latestGSTR3B.upload_timestamp > lastFilingDate) lastFilingDate = latestGSTR3B.upload_timestamp;
            }
            if (latestGSTR2A) {
                gstr2aStatus = 'filed';
                complianceScore += 33.33;
                if (!lastFilingDate || latestGSTR2A.upload_timestamp > lastFilingDate) lastFilingDate = latestGSTR2A.upload_timestamp;
            }
        }

        const compliance = {
            score: Math.round(complianceScore),
            gstr1Status,
            gstr3bStatus,
            gstr2aStatus,
            lastFilingDate
        };

        const activities = recentImports.map(item => ({
            action: `${item.import_type?.replace('_', ' ')} logic import`,
            date: new Date(item.upload_timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            status: item.status?.toLowerCase() === 'completed' ? 'success' : 'pending',
            details: item.original_filename || 'System Import'
        }));

        return {
            currentMonth,
            yearToDate,
            monthlyTrend,
            compliance,
            recentActivities: activities
        };
    }
}

module.exports = DashboardModel;
