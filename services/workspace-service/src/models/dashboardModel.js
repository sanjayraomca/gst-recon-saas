const db = require('../../../shared/src/db/connection');

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
                label: d.toLocaleString('en-US', { month: 'short' }),
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
        const salesQuery = db('sales_invoices')
            .where({ workspace_id: workspaceId })
            .whereIn('book_type', ['SI', 'CN-S', 'DN-S']); // Approximate sales types, filtering returns/notes properly could be complex depending on exact business logic, but total_taxable_value / total_invoice_value generally captures the positive amount. For CN, it's typically negative or handled separately. Assuming standard positive sums for now.
        // Actually, let's just sum across all sales types as per standard GST rules, 
        // CN reduces liability, DN increases it. We'll simplify to just sum all total_taxable_value.

        // Getting all relevant sales records for the FY
        const salesData = await db('sales_invoices')
            .select(
                db.raw(`to_char(invoice_date, 'YYYY-MM') as month`),
                db.raw('SUM(total_taxable_value) as taxable'),
                db.raw('SUM(total_igst + total_cgst + total_sgst + total_cess) as tax'),
                db.raw('SUM(total_invoice_value) as invoice_value')
            )
            .where({ workspace_id: workspaceId })
            .where('invoice_date', '>=', fyStartDate)
            .groupByRaw(`to_char(invoice_date, 'YYYY-MM')`);

        // Getting all relevant purchase records for the FY
        const purchaseData = await db('purchase_vouchers')
            .select(
                db.raw(`to_char(supplier_invoice_date, 'YYYY-MM') as month`),
                db.raw('SUM(taxable_total) as taxable'),
                db.raw('SUM(total_igst_amount + total_cgst_amount + total_sgst_amount + total_cess_amount) as tax'),
                db.raw('SUM(net_amount) as invoice_value')
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

        // Process Current Month metrics
        const currentSalesMonth = salesData.find(r => r.month === currentMonthYM);
        const currentPurchaseMonth = purchaseData.find(r => r.month === currentMonthYM);

        const currentMonth = {
            sales: Number(currentSalesMonth?.taxable || 0),
            purchases: Number(currentPurchaseMonth?.taxable || 0),
            outputTax: Number(currentSalesMonth?.tax || 0),
            inputTax: Number(currentPurchaseMonth?.tax || 0),
            netPayable: Math.max(0, Number(currentSalesMonth?.tax || 0) - Number(currentPurchaseMonth?.tax || 0)) // Simplified logic
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

        // Hardcoded Compliance for now (from original UI)
        const compliance = {
            score: 0,
            gstr1Status: 'pending',
            gstr3bStatus: 'pending',
            gstr2aStatus: 'pending',
            lastFilingDate: null
        };

        return {
            currentMonth,
            yearToDate,
            monthlyTrend,
            compliance
        };
    }
}

module.exports = DashboardModel;
