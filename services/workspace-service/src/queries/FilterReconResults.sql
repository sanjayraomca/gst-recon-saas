-- Transaction: FilterReconResults
-- Last Executed at: 5/6/2026, 7:44:44 PM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["ecdcf531-e3b6-4a7e-a7b2-52f8e2faf8c4"]

select "match_status", count(*) as "count", sum("variance_amount") as "variance" from "reconciliation_results" where "recon_run_id" = 'ecdcf531-e3b6-4a7e-a7b2-52f8e2faf8c4' group by "match_status";
