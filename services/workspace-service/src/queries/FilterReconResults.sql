-- Transaction: FilterReconResults
-- Last Executed at: 5/5/2026, 7:04:16 AM
-- Note: Query results include 'diff_' columns for parity with the dashboard UI.
-- Bindings: []

select "tp".*, "fy"."fy_code" from "tax_periods" as "tp" left join "financial_years" as "fy" on "tp"."fy_id" = "fy"."id" order by "tp"."year" desc, "tp"."month" desc;
