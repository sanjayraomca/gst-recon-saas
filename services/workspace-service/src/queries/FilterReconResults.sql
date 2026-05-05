-- Transaction: FilterReconResults
-- Last Executed at: 5/5/2026, 7:16:44 PM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["4763ca55-716c-4df7-80bf-bdb97c658f29",5]

select "supplier_name", SUM(ABS(variance_amount)) as total_variance, COUNT(*) as invoice_count from "purchase_vouchers" inner join "reconciliation_results" on "purchase_vouchers"."id" = "reconciliation_results"."purchase_invoice_id" where "reconciliation_results"."workspace_id" = '4763ca55-716c-4df7-80bf-bdb97c658f29' group by "supplier_name" order by "total_variance" desc limit 5;
