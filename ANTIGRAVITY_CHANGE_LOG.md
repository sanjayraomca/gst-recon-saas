# Antigravity Change Log

## [2026-06-26] - Activity Center & Filter Alignment

### Fixed
- **Frontend Dashboard Components**:
  - `ActivityCenter.jsx`: Normalized `actionType` to lowercase before mapping to `getActionIcon` and `getActionColor`. Added mapping definitions for `'org_select'`, `'org_create'`, `'create_org'`, `'tenant_registered'`, and `'login_success'`.
  - `ActivityCenter.jsx`: Improved title-casing of action types in `formatActionType`.
  - `ActivityCenter.jsx`: Renamed sidebar summary label from "Recent Imports" to "Today's Activities" to align with the metric of all activities completed today.
  - `ActivityLogList.jsx`: Applied matching lowercase normalizations, added missing mappings, and updated title casing to keep styling consistent.

- **Backend Query Filters**:
  - `tenantController.js`: Updated the database query in `getTenantActivities` to execute case-insensitive matching on `action_type` using `LOWER(activity_logs.action_type)`. Added filter alias routing for ui categories (reconciliation, login/sign ins, deletions, tally sync, user invitations).
  - `activityController.js`: Made matching updates to the query in the notification service `getActivities` controller for consistent API handling.
