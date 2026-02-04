# Phase 7: Notice Management & Compliance Implementation Plan

## 1. Objective
Implement the Notice Management and Compliance module to handle GST notices, generate defense packs automatically using reconciliation data, and manage vendor communications regarding mismatches.

## 2. Scope
*   **GST Notice Management**: Recording notices (DRC-01, SCN, etc.), tracking status, and linking to invoices/periods.
*   **Defense Pack Generation**: Auto-generating reply drafts and organizing evidence (invoices, payment proofs) for notices.
*   **Vendor Communication**: Tracking emails/letters sent to vendors regarding missing invoices or discrepancies.

## 3. Database Schema
Based on `FINAL_DB_SCHEMA_GST_TOOL.sql`.

### 3.1. `gst_notices`
*   **Purpose**: Stores details of notices received from tax authorities.
*   **Key Columns**:
    *   `notice_number` (Unique per workspace)
    *   `notice_type` (Enum: DRC-01, ASMT-10, SCN, etc.)
    *   `demand_amount`, `interest_amount`, `penalty_amount`
    *   `sections_applicable`, `reason_code`
    *   `status` (Enum: OPEN, REPLIED, CLOSED, APPEALED)
    *   `linked_period_ids`, `linked_invoice_ids` (Arrays)

### 3.2. `notice_defense_packs`
*   **Purpose**: Stores generated defense strategies and drafts for a specific notice.
*   **Key Columns**:
    *   `notice_id` (FK)
    *   `defense_strategy` (Enum: FULL_DENIAL, PARTIAL_ACCEPTANCE, etc.)
    *   `draft_reply` (Text)
    *   `legal_grounds` (Text)
    *   `evidence_snapshot_ids` (Links to documents)
    *   `generation_status` (Enum: DRAFT, REVIEW, FILED)

### 3.3. `vendor_communications`
*   **Purpose**: Tracks communications with vendors.
*   **Key Columns**:
    *   `supplier_id` (FK)
    *   `communication_type` (Enum: EMAIL, WHATSAPP, etc.)
    *   `direction` (SENT/RECEIVED)
    *   `related_invoice_ids`
    *   `status` (SENT, DELIVERED, READ, REPLIED)

## 4. API Endpoints
Based on `GST-Reconciliation-API.postman_collection.json`.

### 4.1. Notice Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/notices` | List notices with filters (type, status, date) |
| **POST** | `/notices` | Create a new notice record manually |
| **GET** | `/notices/{notice_id}` | Get detailed notice view |
| **POST** | `/notices/{notice_id}/defense-pack` | Generate or update defense pack |
| **POST** | `/notices/{notice_id}/response` | Record submission of a response |

### 4.2. Vendor Communications
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/vendor-communications` | List communications history |
| **POST** | `/vendor-communications` | Send new communication (Email/System) |

## 5. Service Architecture
*   **Target Service**: `workspace-service` (Recommended) or `compliance-service` (New).
    *   *Recommendation*: Integrate into `workspace-service` as it relies heavily on `purchase_invoices` and `reconciliation_results` which reside there.
*   **Gateway Config**:
    *   Add routes `/notices` and `/vendor-communications` to Kong Gateway pointing to the target service.

## 6. Verification Plan
1.  **Schema Verification**: Ensure tables exist with correct constraints.
2.  **API Testing**: Use Postman to create notice -> generate defense pack -> check status.
3.  **Integration**: Verify `defense-pack` can fetch data from `purchase_invoices` table.

