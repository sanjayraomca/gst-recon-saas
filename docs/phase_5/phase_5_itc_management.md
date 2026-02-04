# Phase 5: ITC Management & Compliance - Implementation Plan

## Overview
Implement Input Tax Credit (ITC) management functionalities including ITC decisioning, reversal tracking (e.g., 180-day rule), and Reverse Charge Mechanism (RCM) liability management.

---

## Endpoints to Implement

### 5.1 ITC Decision Management

#### 1. **GET /itc-decisions**
**Purpose**: List ITC decisions with filtering.

**Query Parameters**:
- `page`, `page_size` - Pagination
- `gstin_id`, `period_id` - Filters
- `decision` - CLAIM, DEFER, REVERSE, etc.
- `decision_type` - AUTO, MANUAL
- `date_from` - Filter by date

**Response**: Paginated list of ITC decisions.

---

### 5.2 ITC Reversal Management

#### 2. **GET /itc-reversals**
**Purpose**: List ITC reversals.

**Query Parameters**:
- `page`, `page_size`
- `reversal_type` - 180_DAY_RULE, etc.
- `date_from`
- `is_reclaimable` - boolean

**Response**: Paginated list of reversals.

#### 3. **POST /itc-reversals/{reversal_id}/reclaim**
**Purpose**: Reclaim previously reversed ITC.

**Request Body**:
```json
{
  "reclaim_date": "2024-01-20",
  "payment_proof_document_id": "doc_uuid",
  "notes": "Payment made to vendor on 2024-01-18"
}
```

**Response**: Success message and updated reversal status.

---

### 5.3 RCM Liability Management

#### 4. **GET /rcm-liabilities**
**Purpose**: List RCM liabilities.

**Query Parameters**:
- `page`, `page_size`
- `gstin_id`, `period_id`
- `liability_status` - PENDING, PAID
- `tax_type` - CGST, SGST, etc.

**Response**: Paginated list of liabilities.

#### 5. **POST /rcm-liabilities/{liability_id}/pay**
**Purpose**: Record payment for RCM liability.

**Request Body**:
```json
{
  "payment_date": "2024-01-20",
  "payment_amount": 9000.00,
  "challan_number": "CH20240120123456",
  "bank_ref_number": "BANKREF123456",
  "payment_proof_document_id": "doc_uuid",
  "notes": "Paid via GST portal challan"
}
```

**Response**: Success message and updated liability status.

---

## Database Tables

### 1. `itc_decisions`

**Key Columns**:
- `id` - UUID
- `workspace_id`, `gstin_id`, `period_id`
- `purchase_invoice_id` - Linked invoice
- `decision` - CLAIM, DEFER, REVERSE, etc.
- `itc_amount` - Tax amounts
- `gst_section` - Section 16(2), 17(5) etc.
- `decision_reason` - Reason for decision

### 2. `itc_reversal_register`

**Key Columns**:
- `id` - UUID
- `reversal_type` - 180_DAY_RULE, BLOCKED_CATEGORY, etc.
- `reversal_amount`
- `is_reclaimable`
- `reclaim_date`, `reclaim_amount`
- `payment_proof_document_id`

### 3. `rcm_liability_register`

**Key Columns**:
- `id` - UUID
- `tax_type` - CGST, SGST, IGST, CESS
- `tax_amount`
- `liability_status` - PENDING, PAID
- `cash_payment_date`, `cash_payment_amount`

---

## Service Placement

**Selected Service**: Add to existing `workspace-service` (since it handles reconciliation and invoice data).

**Structure**:
```
services/workspace-service/
├── src/
│   ├── controllers/
│   │   ├── itcDecisionController.js
│   │   ├── itcReversalController.js
│   │   └── rcmLiabilityController.js
│   ├── models/
│   │   ├── itcDecision.js
│   │   ├── itcReversal.js
│   │   └── rcmLiability.js
│   ├── routes/
│   │   ├── itcRoutes.js
│   │   └── rcmRoutes.js
│   └── services/
│       ├── itcService.js
│       └── rcmService.js
```

---

## Key Features

### 180-Day Reversal Rule
- Automatically track unpaid invoices > 180 days.
- Suggest reversal in `itc_reversal_register`.
- Allow reclamation once payment is proven.

### ITC Blocking
- Identify blocked ITC based on HSN/SAC codes or vendor status.
- Record decisions in `itc_decisions`.

### RCM Tracking
- Identify invoices marked as Reverse Charge.
- Create entries in `rcm_liability_register`.
- Track payment against liabilities.

---

## API Gateway Configuration

```yaml
http:
  routers:
    itc-compliance-routes:
      rule: "Host(`api.gsttool.com`) && (PathPrefix(`/itc-decisions`) || PathPrefix(`/itc-reversals`) || PathPrefix(`/rcm-liabilities`))"
      service: workspace-service
      middlewares:
        - auth-middleware
```

---

## Verification Tests

1. Lists ITC decisions for a period.
2. Verify 180-day rule reversal logic.
3. Reclaim a reversed ITC and verify status update.
4. List pending RCM liabilities.
5. Record RCM payment and verify status update.

---

**Status**: ⏳ **Ready for Implementation**
