-- Transaction: TaxSummary
-- Last Executed at: 3/30/2026, 10:44:08 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["0bfd15ee-e667-41bb-8c5b-83d6d3fe1e54","c977558b-f697-43e1-94e0-f50cc580d893",1]

select * from "reconciliation_status" where "workspace_id" = '0bfd15ee-e667-41bb-8c5b-83d6d3fe1e54' and "gstr_data_id" = 'c977558b-f697-43e1-94e0-f50cc580d893' limit 1;
