-- Transaction: UpdateReconStatus
-- Last Executed at: 4/29/2026, 8:11:18 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: ["not_eligible_for_claim",18336]

update "reconciliation_results" set "action_status" = 'not_eligible_for_claim', "updated_at" = CURRENT_TIMESTAMP where "id" = 18336;
