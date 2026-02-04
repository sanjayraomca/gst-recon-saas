# Phase 1.3: GSTIN Master Management - Implementation Plan

## Overview
Implement GSTIN (GST Identification Number) master data management APIs for managing company GST registrations within workspaces.

---

## Endpoints to Implement

### 1. **GET /gstins**
**Purpose**: List all GSTINs in the workspace with filtering

**Query Parameters**:
- `page`, `page_size` - Pagination (default: page=1, page_size=20)
- `is_active` - Filter by active status (boolean)
- `search` - Search by GSTIN, legal name, or trade name

**Response**: Paginated list of GSTINs

---

### 2. **POST /gstins**
**Purpose**: Register a new GSTIN in the workspace

**Request Body**:
```json
{
  "gstin": "27AAAAA0000A1Z5",
  "legal_name": "Company Pvt Ltd",
  "trade_name": "Company",
  "registration_type": "REGULAR",
  "state_code": "27",
  "registration_date": "2020-04-01",
  "contact_person": "Raj Sharma",
  "contact_email": "accounts@company.com",
  "address": {
    "building": "Tower A",
    "street": "BKC Road",
    "city": "Mumbai",
    "pincode": "400051",
    "state": "Maharashtra"
  }
}
```

**Response**: Created GSTIN with ID (saved to `{{gstin_id}}` variable)

**Validation**:
- GSTIN format validation (15 characters)
- Unique GSTIN per workspace
- State code matches GSTIN prefix
- Valid registration type (REGULAR, COMPOSITION, etc.)

---

### 3. **GET /gstins/{gstin_id}**
**Purpose**: Get detailed GSTIN information

**Response**: Complete GSTIN details including:
- Registration information
- Contact details
- Address
- Status and metadata

---

### 4. **PUT /gstins/{gstin_id}**
**Purpose**: Update GSTIN details (limited fields)

**Allowed Fields**:
```json
{
  "trade_name": "Updated Trade Name",
  "contact_email": "updated@company.com",
  "contact_phone": "+912212345678",
  "is_active": true
}
```

**Business Rules**:
- Cannot modify GSTIN number itself
- Cannot change legal_name (requires new registration)
- Can update contact details and trade name
- Can activate/deactivate GSTIN

---

## Database Table

**Table**: `gstins`

**Key Columns**:
- `id` - Primary key
- `workspace_id` - Foreign key (tenant isolation)
- `gstin` - 15-character GSTIN (unique per workspace)
- `legal_name` - Legal registered name
- `trade_name` - Trade/business name
- `registration_type` - Type of registration
- `state_code` - State code (2 digits)
- `registration_date` - GST registration date
- `contact_person`, `contact_email`, `contact_phone`
- `address` - JSONB field for address
- `is_active` - Active status
- `created_at`, `updated_at`, `deleted_at`

---

## Service Placement

**Recommended**: Add to existing `gstn-service` or `tenant-service`

**Structure**:
```
services/gstn-service/
├── src/
│   ├── controllers/
│   │   └── gstinController.js
│   ├── services/
│   │   └── gstinService.js
│   ├── models/
│   │   └── gstinModel.js
│   ├── routes/
│   │   └── gstinRoutes.js
│   └── validators/
│       └── gstinValidator.js
```

---

## Key Features

### GSTIN Validation
- Format: 2-digit state code + 10-digit PAN + 1-digit entity number + 1-digit 'Z' + 1-digit checksum
- Validate state code matches address
- Validate checksum digit

### Tenant Isolation
- All queries filtered by `workspace_id`
- Users can only access GSTINs in their workspace

### Soft Deletes
- Use `deleted_at` for soft deletes
- Maintain audit trail

---

## API Gateway Configuration

```yaml
http:
  routers:
    gstin-routes:
      rule: "Host(`api.gsttool.com`) && PathPrefix(`/gstins`)"
      service: gstn-service
      middlewares:
        - auth-middleware
```

---

## Verification Tests

1. Create GSTIN via POST
2. List GSTINs with pagination
3. Filter by active status
4. Search by name/GSTIN
5. Get single GSTIN details
6. Update GSTIN contact info
7. Verify tenant isolation

---

**Status**: ⏳ **Ready for Implementation**
