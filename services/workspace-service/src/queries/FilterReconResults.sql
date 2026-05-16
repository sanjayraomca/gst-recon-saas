-- Transaction: FilterReconResults
-- Last Executed at: 5/16/2026, 8:55:46 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["4760cee6-92d2-4683-a3c3-ed15eb06de47","2025-04-01","2026-03-31",5]

select supplier_name, SUM(ABS(variance_amount)) as total_variance, COUNT(*) as invoice_count from "purchase_vouchers" inner join "reconciliation_results" on "purchase_vouchers"."id" = "reconciliation_results"."purchase_invoice_id" where "reconciliation_results"."workspace_id" = '4760cee6-92d2-4683-a3c3-ed15eb06de47' and "book_vchr_date" >= '2025-04-01' and "book_vchr_date" <= '2026-03-31' group by "supplier_name" order by "total_variance" desc limit 5;
