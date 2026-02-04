# Phase 2.2: Supplier Master Management - Implementation Plan

## Overview
Implement supplier master data management APIs for maintaining vendor/supplier information with risk categorization and analytics.

---

## Endpoints to Implement

### 1. **GET /suppliers**
**Purpose**: List suppliers with comprehensive filtering

**Query Parameters**:
- `page`, `page_size` - Pagination
- `search` - Search by name, GSTIN, or supplier code
- `risk_category` - Filter by risk (LOW, MEDIUM, HIGH)
- `supplier_type` - Filter by type (REGULAR, COMPOSITION, UNREGISTERED, etc.)

**Response**: Paginated list of suppliers with summary analytics

---

### 2. **POST /suppliers**
**Purpose**: Create or update supplier master data

**Request Body**:
```json
{
  "supplier_code": "SUP001",
  "supplier_name": "Vendor XYZ Pvt Ltd",
  "gstin": "27BBBBB0000B1Z6",
  "pan": "BBBBB1234B",
  "contact_person": "Vendor Contact",
  "email": "vendor@xyz.com",
  "phone": "+912234567890",
  "address": {
    "street": "Vendor Street",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411001"
  },
  "supplier_type": "REGULAR",
  "risk_category": "MEDIUM",
  "notes": "Preferred vendor for IT services"
}
```

**Response**: Created/updated supplier with ID

**Business Logic**:
- If supplier with same GSTIN exists, update it
- If new GSTIN, create new supplier
- Auto-extract state from GSTIN
- Validate PAN format

---

### 3. **GET /suppliers/{supplier_id}**
**Purpose**: Get detailed supplier information with analytics

**Response**:
```json
{
  "id": "supplier_id",
  "supplier_code": "SUP001",
  "supplier_name": "Vendor XYZ Pvt Ltd",
  "gstin": "27BBBBB0000B1Z6",
  "pan": "BBBBB1234B",
  "contact_person": "Vendor Contact",
  "email": "vendor@xyz.com",
  "phone": "+912234567890",
  "address": {...},
  "supplier_type": "REGULAR",
  "risk_category": "MEDIUM",
  "is_active": true,
  "analytics": {
    "total_invoices": 150,
    "total_value": 5000000.00,
    "pending_payments": 500000.00,
    "last_transaction_date": "2024-01-20",
    "compliance_score": 85
  },
  "created_at": "2023-01-01T00:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

---

### 4. **GET /suppliers/{supplier_id}/invoices**
**Purpose**: Get all invoices for a specific supplier

**Query Parameters**:
- `page`, `page_size` - Pagination
- `period` - Tax period filter
- `itc_status` - ITC eligibility filter

**Response**: Paginated list of invoices from this supplier

---

## Database Table

**Table**: `suppliers`

**Key Columns**:
- `id` - Primary key
- `workspace_id` - Tenant isolation
- `supplier_code` - User-defined code (unique per workspace)
- `supplier_name` - Vendor name
- `gstin` - 15-character GSTIN (nullable for unregistered)
- `pan` - 10-character PAN
- `contact_person`, `email`, `phone`
- `address` - JSONB field
- `supplier_type` - ENUM (REGULAR, COMPOSITION, UNREGISTERED, SEZ, etc.)
- `risk_category` - ENUM (LOW, MEDIUM, HIGH)
- `is_active` - Active status
- `notes` - Additional notes
- `created_at`, `updated_at`, `deleted_at`

**Indexes**:
- `workspace_id, gstin` (unique)
- `workspace_id, supplier_code` (unique)
- `workspace_id, is_active`
- Full-text search on `supplier_name`

---

## Service Placement

**Recommended**: New `supplier-service` or add to `workspace-service`

**Structure**:
```
services/supplier-service/
├── src/
│   ├── controllers/
│   │   └── supplierController.js
│   ├── services/
│   │   ├── supplierService.js
│   │   └── supplierAnalyticsService.js
│   ├── models/
│   │   └── supplierModel.js
│   ├── routes/
│   │   └── supplierRoutes.js
│   └── validators/
│       └── supplierValidator.js
```

---

## Key Features

### 1. Auto-Enrichment
When GSTIN is provided:
- Extract state code from GSTIN
- Validate GSTIN format
- Auto-populate state in address
- Determine supplier type from GSTIN

### 2. Risk Categorization
Factors for risk assessment:
- Transaction volume
- Payment delays
- Compliance history
- GSTIN validity
- Document completeness

**Auto-calculation**:
```javascript
function calculateRiskCategory(supplier) {
  let score = 0;
  
  // High volume = lower risk
  if (supplier.total_value > 10000000) score += 20;
  
  // Regular payments = lower risk
  if (supplier.avg_payment_delay < 30) score += 30;
  
  // Valid GSTIN = lower risk
  if (supplier.gstin && isValidGSTIN(supplier.gstin)) score += 25;
  
  // Compliance = lower risk
  if (supplier.compliance_score > 80) score += 25;
  
  if (score >= 70) return 'LOW';
  if (score >= 40) return 'MEDIUM';
  return 'HIGH';
}
```

### 3. Supplier Analytics
Calculate and cache:
- Total invoice count
- Total transaction value
- Pending payment amount
- Average payment delay
- Last transaction date
- Compliance score

**Update Trigger**: Recalculate when:
- New invoice added
- Payment made
- Invoice amended

---

## Validation Rules

### GSTIN Validation
- Format: 15 characters
- Pattern: `\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}`
- State code must match address state

### PAN Validation
- Format: 10 characters
- Pattern: `[A-Z]{5}\d{4}[A-Z]{1}`
- Must match GSTIN (characters 3-12)

### Supplier Code
- Unique per workspace
- Alphanumeric, max 20 characters
- Auto-generate if not provided

---

## Business Rules

### Duplicate Prevention
- Same GSTIN cannot exist twice in workspace
- Same supplier_code cannot exist twice
- If GSTIN exists, update existing record

### Soft Deletes
- Mark as `deleted_at` instead of hard delete
- Maintain historical data
- Can be restored if needed

### Audit Trail
- Track all changes to supplier master
- Log who made changes and when
- Maintain version history

---

## API Gateway Configuration

```yaml
http:
  routers:
    supplier-service:
      rule: "Host(`api.gsttool.com`) && PathPrefix(`/suppliers`)"
      service: supplier-service
      middlewares:
        - auth-middleware
```

---

## Integration Points

### With Upload Service
- Auto-create suppliers from uploaded invoices
- Extract supplier data from GSTR2B
- Update supplier info on new data

### With Transaction Service
- Link invoices to suppliers
- Calculate supplier analytics
- Track payment status

### With Reconciliation Service
- Supplier-wise reconciliation reports
- Mismatch analysis by supplier
- Compliance tracking

---

## Verification Tests

1. Create supplier via POST
2. List suppliers with pagination
3. Filter by risk category
4. Search by name/GSTIN
5. Get supplier details with analytics
6. Get supplier invoices
7. Update supplier information
8. Test duplicate GSTIN handling
9. Verify tenant isolation
10. Test soft delete

---

## Dependencies

```json
{
  "express": "^4.18.2",
  "knex": "^2.5.1",
  "joi": "^17.9.2"
}
```

---

**Status**: ⏳ **Ready for Implementation**
