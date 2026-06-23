-- Transaction: TaxSummary
-- Last Executed at: 6/23/2026, 6:11:56 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["65d2f79e-da1d-4517-993c-737dc85bc6a0","COMPLETED","PURCHASE_2A","GSTR2A_VS_GSTR2B","PURCHASE_2A_VS_2B",1]

select * from "reconciliation_runs" where "workspace_id" = '65d2f79e-da1d-4517-993c-737dc85bc6a0' and "status" = 'COMPLETED' and "run_type" in ('PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B') order by "created_at" desc limit 1;
