# Phase 3: Transaction Management - Implementation Plan

## Overview
Phase 3 focuses on implementing transaction management APIs for Purchase Invoices and GSTR2B Invoice Management as defined in the Postman collection.

---

## 3.1 Purchase Invoices

### Endpoints to Implement

#### 1. **GET /purchase-invoices**
**Purpose**: List purchase invoices with comprehensive filtering

**Query Parameters**:
- `page`, `page_size` - Pagination
- `gstin_id` - Filter by GSTIN
- `supplier_id` - Filter by supplier
- `period` - Tax period (e.g., "042024")
- `invoice_date_from`, `invoice_date_to` - Date range
- `itc_eligibility_status` - ITC status filter
- `reverse_charge` - Boolean filter
- `payment_status` - Payment status filter
- `search` - Text search on invoice number

**Response**: Paginated list of purchase invoices with reconciliation metadata

---

#### 2. **POST /purchase-invoices**
**Purpose**: Create purchase invoice (manual entry)

**Request Body**:
```json
{
  "gstin_id": "{{gstin_id}}",
  "invoice_number": "INV-2024-001",
  "invoice_date": "2024-01-15",
  "posting_date": "2024-01-15",
  "supplier_gstin": "27CCCCC0000C1Z7",
  "supplier_name": "Vendor ABC",
  "taxable_value": 10000.00,
  "cgst_amount": 900.00,
  "sgst_amount": 900.00,
  "igst_amount": 0.00,
  "cess_amount": 0.00,
  "place_of_supply_code": "27",
  "supply_type": "B2B",
  "reverse_charge": false,
  "hsn_sac_code": "9963",
  "item_description": "Professional services",
  "itc_eligibility_status": "ELIGIBLE",
  "payment_status": "UNPAID",
  "source_system": "MANUAL"
}
```

**Response**: Created invoice with ID

---

#### 3. **GET /purchase-invoices/{invoice_id}**
**Purpose**: Get detailed invoice information with reconciliation data

**Response**: Complete invoice details including:
- Invoice header information
- Tax breakdown
- Reconciliation status
- Payment details
- Amendment history

---

#### 4. **PUT /purchase-invoices/{invoice_id}**
**Purpose**: Update invoice (limited fields only)

**Allowed Fields**:
```json
{
  "payment_status": "PAID",
  "payment_date": "2024-01-20",
  "payment_amount": 11800.00,
  "itc_eligibility_status": "ELIGIBLE",
  "notes": "Payment completed via bank transfer"
}
```

**Business Rules**:
- Only specific fields can be updated
- Cannot modify core invoice data (amounts, dates, supplier)
- Use amendment endpoint for corrections

---

#### 5. **POST /purchase-invoices/{invoice_id}/amend**
**Purpose**: Create invoice amendment for corrections

**Request Body**:
```json
{
  "amendment_type": "CORRECTION",
  "amendment_reason": "Tax amount correction",
  "changes": {
    "taxable_value": 11000.00,
    "cgst_amount": 990.00,
    "sgst_amount": 990.00
  }
}
```

**Business Rules**:
- Creates amendment record
- Maintains audit trail
- Original invoice remains unchanged
- Amendment linked to original

---

## 3.2 GSTR2B Invoice Management

### Endpoints to Implement

#### 1. **GET /gstr2b-invoices**
**Purpose**: List GSTR2B invoices (from government portal)

**Query Parameters**:
- `page`, `page_size` - Pagination
- `gstin_id` - Filter by GSTIN
- `period` - Tax period
- `supplier_gstin` - Filter by supplier GSTIN
- `itc_availability` - ITC availability status
- `match_status` - Reconciliation match status

**Response**: Paginated list of GSTR2B invoices

---

#### 2. **GET /gstr2b-invoices/{invoice_id}**
**Purpose**: Get detailed GSTR2B invoice information

**Response**: Complete GSTR2B invoice details including:
- Invoice data from government portal
- Match status with purchase register
- ITC availability
- Discrepancies if any

---

## Database Tables

### Primary Tables
1. **`purchase_register`** - Stores purchase invoices
2. **`gstr2b_invoices`** - Stores GSTR2B data from uploads

### Related Tables
- `suppliers` - Supplier master data
- `gstins` - GSTIN master data
- `invoice_amendments` - Amendment tracking
- `reconciliation_results` - Match results

---

## Technical Note: Database Consistency (Resolved in Phase 4)
During Phase 4 debugging, a critical "Split Brain" issue was identified where `gstn-service` was writing to the `keycloak` database instead of `appdb`.
**Resolution**: All Docker services must be configured with `DB_NAME=appdb`.
**Impact**: If you created GSTINs prior to this fix, they may be missing from `appdb`. Please recreate them or ensure your environment uses the updated `docker-compose.yml`.

---

## Service Architecture

### Implementation in Existing Services

**Service**: `workspace-service` (existing)

**Why workspace-service?**
- Transaction data is workspace-specific
- Already handles workspace-scoped data
- Maintains logical grouping of workspace operations
- No need for additional service deployment

**New Files to Add**:
```
services/workspace-service/
├── src/
│   ├── controllers/
│   │   ├── purchaseInvoiceController.js  ← NEW
│   │   └── gstr2bInvoiceController.js    ← NEW
│   ├── services/
│   │   ├── purchaseInvoiceService.js     ← NEW
│   │   └── gstr2bInvoiceService.js       ← NEW
│   ├── models/
│   │   ├── purchaseInvoiceModel.js       ← NEW
│   │   └── gstr2bInvoiceModel.js         ← NEW
│   ├── routes/
│   │   ├── purchaseInvoiceRoutes.js      ← NEW
│   │   └── gstr2bInvoiceRoutes.js        ← NEW
│   └── validators/
│       └── invoiceValidator.js           ← NEW
```

**Update Existing Files**:
- `src/index.js` - Add new routes
- `package.json` - Add any new dependencies (if needed)

---


## Implementation Details

### 1. Controllers
- Handle HTTP requests/responses
- Validate input using middleware
- Call service layer
- Return standardized responses

### 2. Services
- Business logic implementation
- Data validation
- Database operations via models
- Error handling

### 3. Models
- Knex-based database queries
- CRUD operations
- Complex queries with joins
- Pagination helpers

### 4. Validators
- Input validation schemas
- Field-level validation
- Business rule validation

---

## Key Features

### Tenant Isolation
- All queries filtered by `workspace_id`
- Middleware enforces tenant context
- No cross-tenant data access

### Pagination
- Standard pagination for list endpoints
- Page size limits (max 100)
- Total count in response

### Filtering
- Multiple filter combinations
- Date range filtering
- Status-based filtering
- Full-text search on invoice numbers

### Audit Trail
- All amendments tracked
- Created/updated timestamps
- User tracking via JWT

---

## API Gateway Configuration

### Traefik Routes (Update existing workspace-service routes)

Add to `services/api-gateway/traefik_dynamic.yml`:

```yaml
http:
  routers:
    workspace-service:
      rule: "Host(`api.gsttool.com`) && (PathPrefix(`/workspaces`) || PathPrefix(`/purchase-invoices`) || PathPrefix(`/gstr2b-invoices`))"
      service: workspace-service
      middlewares:
        - auth-middleware

  services:
    workspace-service:
      loadBalancer:
        servers:
          - url: "http://workspace-service:3000"
```

**Note**: This extends the existing workspace-service router to handle transaction endpoints.

---

## Verification Plan

### Automated Tests
1. **Purchase Invoices**:
   - Create invoice via POST
   - List invoices with filters
   - Get invoice details
   - Update payment status
   - Create amendment

2. **GSTR2B Invoices**:
   - List GSTR2B invoices
   - Get invoice details
   - Filter by match status

### Test Script
Create `verify_phase3.sh`:
```bash
#!/bin/bash
# Test Phase 3 endpoints
# - Purchase invoice CRUD
# - GSTR2B invoice queries
# - Filtering and pagination
# - Amendment workflow
```

---

## Dependencies

### NPM Packages
- `express` - Web framework
- `knex` - Query builder
- `pg` - PostgreSQL client
- `joi` - Validation
- `jsonwebtoken` - JWT handling

### Shared Modules
- `@shared/middleware/authMiddleware`
- `@shared/utils/responseHandler`
- `@shared/db/connection`

---

## Environment Variables

```env
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=appdb
DB_USER=postgres
DB_PASSWORD=postgres

# Service
PORT=3000
NODE_ENV=production

# JWT
JWT_SECRET=your-secret-key
```

---

## Success Criteria

✅ All 7 endpoints functional  
✅ Proper tenant isolation  
✅ Pagination working correctly  
✅ Filtering returns accurate results  
✅ Amendment workflow complete  
✅ Validation prevents invalid data  
✅ Error handling comprehensive  
✅ API Gateway routing configured  

---

## Next Steps After Approval

1. Add new controllers to `workspace-service/src/controllers/`
2. Add new services to `workspace-service/src/services/`
3. Add new models to `workspace-service/src/models/`
4. Add new routes to `workspace-service/src/routes/`
5. Add validators to `workspace-service/src/validators/`
6. Update `workspace-service/src/index.js` to register new routes
7. Update API Gateway configuration in `traefik_dynamic.yml`
8. Create verification script `verify_phase3.sh`
9. Run comprehensive tests
10. Document any issues or deviations

---

**Status**: ⏳ **Awaiting User Confirmation**

Please review this plan and confirm to proceed with implementation.
