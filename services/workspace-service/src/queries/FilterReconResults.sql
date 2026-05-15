-- Transaction: FilterReconResults
-- Last Executed at: 5/15/2026, 11:37:09 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: []

select "state", "code" from "state_code_master" order by "state" asc;
