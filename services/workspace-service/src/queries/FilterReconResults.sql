-- Transaction: FilterReconResults
-- Last Executed at: 4/21/2026, 7:31:03 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: []

select "state", "code" from "state_code_master" order by "state" asc;
