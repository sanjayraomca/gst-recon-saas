-- Transaction: FilterReconResults
-- Last Executed at: 5/19/2026, 8:32:42 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["4760cee6-92d2-4683-a3c3-ed15eb06de47",5]

select supplier_name, SUM(ABS(variance_amount)) as total_variance, COUNT(*) as invoice_count from "purchase_vouchers" inner join "reconciliation_results" on "purchase_vouchers"."id" = "reconciliation_results"."purchase_invoice_id" where "reconciliation_results"."workspace_id" = '4760cee6-92d2-4683-a3c3-ed15eb06de47' group by "supplier_name" order by "total_variance" desc limit 5;
