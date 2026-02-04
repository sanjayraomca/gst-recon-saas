# Phase 4.1: Basic Reconciliation Matching - Confirmation Document

---

## 0. Document Control & Metadata ⭐

- **Document Name**: Phase 4.1 - Basic Reconciliation Matching
- **Module Name**: Reconciliation Engine - Basic Matching
- **Version**: 1.0.0
- **Compatible Platform**: GST Reconciliation SaaS v1.0
- **Author**: AI (Antigravity) + Human (Tanvir)
- **Creation Date**: 2026-01-27
- **Last Updated**: 2026-01-27
- **Change Log**:
  - v1.0.0 → Initial Phase 4.1 specification
- **VIBE Compliance Target**: 100%

---

## 1. Executive Summary

### Problem Statement
Purchase invoices from company books need to be matched with GSTR2B invoices from government portal to identify discrepancies and ensure ITC (Input Tax Credit) compliance.

### What This Module Solves
- Automated matching of purchase invoices with GSTR2B data
- Identification of matched, unmatched, and partially matched invoices
- Discrepancy detection (amount mismatches, missing invoices)
- Match status tracking for reconciliation reporting

### Business Value
- Reduces manual reconciliation effort by 90%
- Ensures ITC compliance
- Identifies potential tax savings
- Provides audit trail for tax authorities

### In-Scope (Phase 4.1)
- ✅ Basic invoice matching by invoice number and supplier GSTIN
- ✅ Match status tracking (MATCHED, UNMATCHED, PARTIAL_MATCH)
- ✅ Simple discrepancy detection (amount differences)
- ✅ Match results storage in database
- ✅ API to trigger reconciliation for a period
- ✅ API to view reconciliation results

### Explicit Out-of-Scope (Phase 4.1)
- ❌ Advanced fuzzy matching algorithms
- ❌ Machine learning-based matching
- ❌ Bulk reconciliation across multiple periods
- ❌ Automated ITC claim generation
- ❌ Integration with government portal for auto-fetch
- ❌ Email notifications for discrepancies

---

## 2. Introduction & Goals

### Background
After implementing Phase 3 (Transaction Management), we now have:
- Purchase invoices from company books
- GSTR2B invoices from government portal uploads

These need to be reconciled to ensure tax compliance.

### Goals & Objectives
1. Implement basic matching logic for invoices
2. Store match results in database
3. Provide APIs to trigger and view reconciliation
4. Support single-period reconciliation

### Success Criteria
- ✅ Reconciliation completes within 30 seconds for 1000 invoices
- ✅ Match accuracy > 95% for exact matches
- ✅ All match results stored with audit trail
- ✅ APIs return results within 2 seconds

### Known Constraints
- **Technical**: Single-threaded processing (no parallel matching yet)
- **Time**: Phase 4.1 focuses on basic matching only
- **Data**: Requires both purchase invoices and GSTR2B data to exist

### Assumptions
1. Invoice numbers are reasonably standardized
2. Supplier GSTIN is accurate in both datasets
3. Amounts are in same currency (INR)
4. Dates are in ISO 8601 format

---

## 3. AI Coding Rules & Constraints ⭐⭐⭐ (MANDATORY)

### Code Quality Rules
- ✅ No TODO / stub / placeholder code
- ✅ No commented or dead code
- ✅ No unused imports or variables
- ✅ All functions must have JSDoc comments

### Performance Rules
- ✅ Low memory footprint (process in batches if needed)
- ✅ CPU-efficient logic (avoid nested loops)
- ✅ Use database indexes for matching queries
- ✅ Limit result sets with pagination

### Structure Rules
- ✅ Follow existing workspace-service structure
- ✅ Create files in designated locations only:
  - `services/workspace-service/src/controllers/reconciliationController.js`
  - `services/workspace-service/src/models/reconciliationModel.js`
  - `services/workspace-service/src/routes/reconciliationRoutes.js`
- ✅ No new folders unless explicitly approved

### Dependency Rules
- ✅ Use only existing dependencies (Knex, Express, etc.)
- ✅ No new NPM packages for Phase 4.1
- ✅ Prefer native JavaScript utilities

### Security Rules
- ✅ No hardcoded secrets
- ✅ Validate all external inputs
- ✅ Enforce workspace isolation (all queries filtered by workspace_id)
- ✅ Use parameterized queries (Knex) to prevent SQL injection

### Testing Rules
- ✅ Unit tests not required for Phase 4.1 (manual testing via Postman)
- ✅ Provide test data examples in confirmation doc

### Hallucination Guardrail (MANDATORY)
- ✅ If any required utility, environment variable, or dependency is missing, **ASK FOR CLARIFICATION**
- ✅ **DO NOT** invent placeholder values or fake infrastructure
- ✅ **DO NOT** assume table structures - refer to FINAL_DB_SCHEMA_GST_TOOL.sql

### Output Rule
- ✅ Code must be production-ready in a single pass
- ✅ All endpoints must work with existing auth middleware
- ✅ Follow existing response format (successResponse/errorResponse)

---

## 4. Developer Mental Model & Code Style ⭐

### Architecture Pattern
- **Pattern**: Layered Architecture (Controller → Model → Database)
- **Service Layer**: Not required for Phase 4.1 (simple logic)

### Programming Style
- **Style**: Functional JavaScript with async/await
- **Max File Size**: 300 lines per file
- **Max Function Size**: 50 lines per function

### Naming Conventions
- **Files**: camelCase (e.g., `reconciliationController.js`)
- **Functions**: camelCase (e.g., `triggerReconciliation`)
- **Variables**: camelCase (e.g., `matchResults`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MATCH_STATUS_MATCHED`)

### Error Handling
- **Approach**: Centralized error handling via `errorResponse` utility
- **Pattern**: Try-catch in all async functions
- **Logging**: Console.error for debugging (structured logging not required yet)

---

## 5. Implementation Context (Token-Saving Guardrails) ⭐⭐⭐

### 5.1 Shared Utils / Hooks (DO NOT REIMPLEMENT)
**Existing utilities to REUSE**:
- `services/shared/src/utils/responseHandler.js` → `successResponse`, `errorResponse`
- `services/shared/src/middleware/authMiddleware.js` → `verifyToken`
- `services/shared/src/db/connection.js` → Knex database connection

### 5.2 Reference Files (Source of Truth)
**Follow patterns from**:
- `services/workspace-service/src/controllers/purchaseInvoiceController.js` → Controller structure
- `services/workspace-service/src/models/purchaseInvoiceModel.js` → Model structure
- `services/workspace-service/src/routes/purchaseInvoiceRoutes.js` → Route structure

### 5.3 Library Lockdown
- **Node.js**: v18.20.8
- **Express**: Existing version (no upgrade)
- **Knex**: Existing version
- **PostgreSQL**: 14+

### 5.4 Known Conflicts / Anti-Patterns
**DO NOT**:
- ❌ Use spread operator in Knex inserts (causes DEFAULT issues)
- ❌ Use `req.workspaceId` (use `req.headers['x-workspace-id']` instead)
- ❌ Include auto-generated columns in INSERT statements
- ❌ Use soft deletes (no `deleted_at` column exists)

### 5.5 Explicit Out-of-Scope
**DO NOT touch**:
- ❌ Existing Phase 1-3 code
- ❌ Auth middleware
- ❌ Database schema (use existing tables only)
- ❌ Docker configuration

---

## 6. Modules & Functional Scope

### Module Name
**Reconciliation Engine - Basic Matching (Phase 4.1)**

### Responsibilities
1. Match purchase invoices with GSTR2B invoices
2. Calculate match status and discrepancies
3. Store reconciliation results
4. Provide APIs to trigger and view results

### Included Features
- ✅ Trigger reconciliation for a specific GSTIN and period
- ✅ Match invoices by invoice number + supplier GSTIN
- ✅ Detect amount discrepancies
- ✅ Store match results in `reconciliation_results` table
- ✅ View reconciliation summary and details

### Excluded Features
- ❌ Fuzzy matching
- ❌ Bulk reconciliation
- ❌ Automated notifications
- ❌ ITC claim generation

### Dependencies
- **Internal**: purchase_invoices table, gstr2b_invoices table
- **External**: None

---

## 7. Actors & Roles

### Actor: Authenticated User
- **Role Type**: Human
- **Permissions**: Trigger reconciliation, view results
- **Restrictions**: Can only access their workspace data
- **Access Scope**: Workspace-level (filtered by workspace_id)

---

## 8. Business Rules ⭐

### BR-4.1.1: Invoice Matching Criteria
- **Description**: Two invoices match if invoice_number AND supplier_gstin are identical
- **Applies to**: Reconciliation matching logic
- **Validation**: Case-insensitive comparison, trim whitespace
- **Failure Behavior**: Mark as UNMATCHED
- **Exceptions**: None

### BR-4.1.2: Amount Tolerance
- **Description**: Amounts are considered matched if difference is ≤ ₹1.00
- **Applies to**: Discrepancy calculation
- **Validation**: `Math.abs(amount1 - amount2) <= 1.00`
- **Failure Behavior**: Mark as PARTIAL_MATCH if invoice matches but amount differs
- **Exceptions**: None

### BR-4.1.3: Match Status Values
- **Description**: Only 3 valid statuses: MATCHED, UNMATCHED, PARTIAL_MATCH
- **Applies to**: reconciliation_results table
- **Validation**: Enum constraint
- **Failure Behavior**: Database constraint violation
- **Exceptions**: None

---

## 9. Database Schema Definitions ⭐⭐

### Database Engine
- **Engine**: PostgreSQL 14+
- **Schema**: public
- **Naming Convention**: snake_case

### Table: reconciliation_results

**Purpose**: Store results of invoice matching

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique identifier |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) | Workspace isolation |
| gstin_id | UUID | NOT NULL, FK → gstins(id) | GSTIN being reconciled |
| reconciliation_period | VARCHAR(6) | NOT NULL | Tax period (MMYYYY) |
| purchase_invoice_id | UUID | FK → purchase_invoices(id) | Matched purchase invoice |
| gstr2b_invoice_id | UUID | FK → gstr2b_invoices(id) | Matched GSTR2B invoice |
| match_status | VARCHAR(20) | NOT NULL | MATCHED, UNMATCHED, PARTIAL_MATCH |
| discrepancy_type | VARCHAR(50) | NULL | AMOUNT_MISMATCH, MISSING_IN_GSTR2B, etc. |
| discrepancy_amount | DECIMAL(15,2) | NULL | Amount difference |
| notes | TEXT | NULL | Additional notes |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Record creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Last update time |

**Indexes**:
```sql
CREATE INDEX idx_recon_workspace_period ON reconciliation_results(workspace_id, reconciliation_period);
CREATE INDEX idx_recon_status ON reconciliation_results(match_status);
CREATE INDEX idx_recon_purchase_inv ON reconciliation_results(purchase_invoice_id);
CREATE INDEX idx_recon_gstr2b_inv ON reconciliation_results(gstr2b_invoice_id);
```

**Note**: This table already exists in FINAL_DB_SCHEMA_GST_TOOL.sql - verify structure before implementation.

### Table: reconciliation_actions (Phase 4.3 Addition)
**Purpose**: Store audit trail of user actions on reconciliation results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique ID |
| reconciliation_result_id | UUID | FK -> reconciliation_results | Linked result |
| action_type | VARCHAR | NOT NULL | APPROVE_MATCH, REJECT_MATCH |
| decision | VARCHAR | NULL | CLAIM, REVERSE |
| performed_by | UUID | FK -> users | User who acted |
| notes | TEXT | NULL | Comments |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Timestamp |

---

## 10. Recently Resolved Debugging Issues (Technical Note)
During implementation, the following critical issues were resolved:

1.  **Token Expiry (403/401)**:
    - **Issue**: Short-lived tokens causing 403 errors.
    - **Fix**: Updated `authMiddleware.js` to distinguish between invalid token (403) and expired token (401).

2.  **500 Internal Server Error (Invalid UUID)**:
    - **Issue**: Passing JWT token in `gstin_id` crashed the DB query.
    - **Fix**: Added strict regex validation for all UUID inputs in Controller.

3.  **Foreign Key Violation (Workspace ID)**:
    - **Issue**: Invalid Workspace ID caused raw SQL errors.
    - **Fix**: Added handling for SQL State `23503` to return 404 "Workspace not found".

4.  **Database Split Brain**:
    - **Issue**: `gstn-service` was writing to `keycloak` DB while `workspace-service` read from `appdb`.
    - **Fix**: Standardized `DB_NAME=appdb` across all Docker services.

---

## 11. API Definitions ⭐⭐

### API 1: Trigger Reconciliation

**Endpoint**: `POST /reconciliations/trigger`

**Purpose**: Start reconciliation for a specific GSTIN and period

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
X-Workspace-ID: <workspace_uuid>
Content-Type: application/json
```

**Request Body**:
```json
{
  "gstin_id": "7ebd1783-77a1-4ea0-9298-f1670f209822",
  "period": "012025"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Reconciliation completed successfully",
  "data": {
    "summary": {
      "total_purchase_invoices": 150,
      "total_gstr2b_invoices": 145,
      "matched": 140,
      "unmatched_purchase": 10,
      "unmatched_gstr2b": 5,
      "partial_match": 5
    },
    "reconciliation_id": "uuid-here"
  }
}
```

**Business Logic**:
1. Validate gstin_id exists and belongs to workspace
2. Fetch all purchase invoices for period
3. Fetch all GSTR2B invoices for period
4. Match invoices by invoice_number + supplier_gstin
5. Calculate discrepancies
6. Store results in reconciliation_results table
7. Return summary

---

### API 2: Get Reconciliation Results

**Endpoint**: `GET /reconciliations/results`

**Purpose**: View reconciliation results with filters

**Query Parameters**:
- `gstin_id` (required): UUID
- `period` (required): MMYYYY format
- `match_status` (optional): MATCHED | UNMATCHED | PARTIAL_MATCH
- `page` (optional, default: 1)
- `page_size` (optional, default: 50, max: 100)

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "uuid",
        "purchase_invoice": {
          "invoice_number": "INV-001",
          "supplier_name": "ABC Corp",
          "invoice_total": 11800.00
        },
        "gstr2b_invoice": {
          "invoice_number": "INV-001",
          "supplier_name": "ABC Corp",
          "invoice_total": 11800.00
        },
        "match_status": "MATCHED",
        "discrepancy_type": null,
        "discrepancy_amount": null
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 50,
      "total": 150,
      "total_pages": 3
    }
  }
}
```

---

## 11. Implementation Checklist

### Files to Create
- [ ] `services/workspace-service/src/controllers/reconciliationController.js`
- [ ] `services/workspace-service/src/models/reconciliationModel.js`
- [ ] `services/workspace-service/src/routes/reconciliationRoutes.js`

### Files to Update
- [ ] `services/workspace-service/src/index.js` (mount new routes)

### Database
- [ ] Verify `reconciliation_results` table exists in schema
- [ ] Create indexes if missing

### Testing
- [ ] Test trigger reconciliation with sample data
- [ ] Test get results with filters
- [ ] Test pagination
- [ ] Test workspace isolation

---

## 12. Success Criteria

✅ **Functional**:
- Reconciliation completes successfully for test period
- Match status correctly identifies MATCHED/UNMATCHED/PARTIAL_MATCH
- Discrepancies are calculated accurately
- Results are stored in database

✅ **Performance**:
- Reconciliation completes within 30 seconds for 1000 invoices
- API responses within 2 seconds

✅ **Security**:
- Workspace isolation enforced
- Only authenticated users can trigger reconciliation

---

**Status**: ⏳ **Awaiting User Confirmation**

Please review this Phase 4.1 specification and confirm to proceed with implementation.
