-- Transaction: FilterReconResults
-- Last Executed at: 5/15/2026, 6:08:07 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["sarani@gmail.com",1]

select "id", "tenant_id", "auth_provider_id" from "users" where "email" = 'sarani@gmail.com' limit 1;
