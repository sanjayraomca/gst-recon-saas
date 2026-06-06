-- Transaction: FilterReconResults
-- Last Executed at: 6/6/2026, 9:35:56 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["27a03eef-b173-4ec9-a94b-c64a89309c01","2025-04-01","2026-03-31",5]

select MAX(COALESCE(pv.supplier_name, gi.supplier_name)) as supplier_name, MAX(COALESCE(pv.supplier_gstin, gi.supplier_gstin)) as supplier_gstin, SUM(ABS(variance_amount)) as total_variance, COUNT(*) as invoice_count from "reconciliation_results" left join "purchase_vouchers" as "pv" on "reconciliation_results"."purchase_invoice_id" = "pv"."id" left join "normalized_gstr2b_invoices" as "gi" on "reconciliation_results"."gstr2b_invoice_id" = "gi"."id" where "reconciliation_results"."recon_run_id" = '27a03eef-b173-4ec9-a94b-c64a89309c01' and COALESCE(pv.book_vchr_date, gi.document_date) >= '2025-04-01' and COALESCE(pv.book_vchr_date, gi.document_date) <= '2026-03-31' group by COALESCE(pv.supplier_gstin, gi.supplier_gstin) order by "total_variance" desc limit 5;
