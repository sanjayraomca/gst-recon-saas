-- Transaction: FilterReconResults
-- Last Executed at: 5/11/2026, 6:50:16 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["18ca0e10-324d-4cfe-8252-12d4cb1dd4f2","0caa2e87-68c7-4e5a-9020-ccce3b0332b0"]

select * from "gstin_master" where "id" in ('18ca0e10-324d-4cfe-8252-12d4cb1dd4f2', '0caa2e87-68c7-4e5a-9020-ccce3b0332b0');
