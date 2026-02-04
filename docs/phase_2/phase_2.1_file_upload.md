# Phase 2.1: File Upload & Processing - Implementation Plan

## Overview
Implement file upload and processing APIs for GST data files (GSTR2B, Purchase Register, etc.) with asynchronous processing capabilities.

---

## Endpoints to Implement

### 1. **POST /uploads**
**Purpose**: Upload GST data files for processing

**Request Type**: `multipart/form-data`

**Form Fields**:
- `file` - File to upload (CSV, Excel, JSON)
- `upload_type` - Type of upload (GSTR2B, PURCHASE_REGISTER, SALES_REGISTER, etc.)
- `gstin_id` - GSTIN ID for this upload
- `period_code` - Tax period (format: MMYYYY, e.g., "042024")

**Supported Upload Types**:
- `GSTR2B` - GSTR2B data from GST portal
- `PURCHASE_REGISTER` - Purchase register from ERP
- `SALES_REGISTER` - Sales register from ERP
- `GSTR1` - GSTR1 data

**Response**: Upload record with processing status

**Processing Flow**:
1. Validate file format and size
2. Store file in uploads directory
3. Create upload record with status "PENDING"
4. Trigger async processing via NATS
5. Return upload ID immediately

---

### 2. **GET /uploads**
**Purpose**: List file uploads with filtering

**Query Parameters**:
- `page`, `page_size` - Pagination
- `upload_type` - Filter by upload type
- `status` - Filter by status (PENDING, PROCESSING, COMPLETED, FAILED)
- `gstin_id` - Filter by GSTIN

**Response**: Paginated list of uploads with:
- Upload metadata
- Processing status
- Record counts
- Error summary if failed

---

### 3. **GET /uploads/{upload_id}**
**Purpose**: Get detailed upload information with processing results

**Response**:
```json
{
  "id": "upload_id",
  "upload_type": "GSTR2B",
  "gstin_id": "gstin_id",
  "period_code": "042024",
  "status": "COMPLETED",
  "file_name": "gstr2b_april_2024.csv",
  "file_size": 1024000,
  "uploaded_at": "2024-01-15T10:30:00Z",
  "processing_started_at": "2024-01-15T10:30:05Z",
  "processing_completed_at": "2024-01-15T10:32:00Z",
  "records_processed": 1500,
  "records_inserted": 1450,
  "records_updated": 50,
  "records_failed": 0,
  "errors": [],
  "uploaded_by": "user@company.com"
}
```

---

### 4. **POST /uploads/{upload_id}/retry**
**Purpose**: Retry failed upload processing

**Response**: Updated upload record with new processing attempt

**Business Rules**:
- Only failed uploads can be retried
- Creates new processing attempt
- Maintains history of all attempts

---

## Database Tables

### Primary Table: `uploads`

**Columns**:
- `id` - Primary key
- `workspace_id` - Tenant isolation
- `gstin_id` - Foreign key to gstins
- `upload_type` - Type of upload
- `period_code` - Tax period
- `file_name` - Original filename
- `file_path` - Stored file path
- `file_size` - File size in bytes
- `status` - Processing status
- `records_processed` - Total records
- `records_inserted` - Successfully inserted
- `records_updated` - Updated records
- `records_failed` - Failed records
- `error_summary` - JSONB field for errors
- `uploaded_by` - User ID
- `processing_started_at`
- `processing_completed_at`
- `created_at`, `updated_at`

---

## Service Architecture

**Service Name**: `upload-service`

**Structure**:
```
services/upload-service/
├── src/
│   ├── controllers/
│   │   └── uploadController.js
│   ├── services/
│   │   ├── uploadService.js
│   │   └── fileProcessorService.js
│   ├── processors/
│   │   ├── gstr2bProcessor.js
│   │   ├── purchaseRegisterProcessor.js
│   │   └── salesRegisterProcessor.js
│   ├── models/
│   │   └── uploadModel.js
│   ├── routes/
│   │   └── uploadRoutes.js
│   └── validators/
│       └── uploadValidator.js
├── uploads/ (volume mount)
└── Dockerfile
```

---

## File Processing Flow

### 1. Upload Phase
```
User uploads file
  ↓
Validate file (type, size, format)
  ↓
Store file in /uploads directory
  ↓
Create upload record (status: PENDING)
  ↓
Publish NATS message: "upload.process"
  ↓
Return upload ID to user
```

### 2. Processing Phase (Async via NATS)
```
NATS subscriber receives message
  ↓
Update status to PROCESSING
  ↓
Read and parse file
  ↓
Validate each record
  ↓
Insert/update database records
  ↓
Update upload record with results
  ↓
Set status to COMPLETED or FAILED
```

---

## File Format Support

### CSV Files
- Parse using `csv-parser` or `papaparse`
- Handle different delimiters
- Skip header row
- Validate column mapping

### Excel Files
- Parse using `xlsx` library
- Support .xlsx and .xls formats
- Handle multiple sheets
- Extract data from specific sheet

### JSON Files
- Parse and validate structure
- Support nested objects
- Batch processing for large files

---

## Error Handling

### File Validation Errors
- Invalid file type
- File too large (max 50MB)
- Corrupted file
- Missing required fields

### Processing Errors
- Invalid data format
- Duplicate records
- Foreign key violations
- Data type mismatches

**Error Storage**:
```json
{
  "errors": [
    {
      "row": 15,
      "field": "invoice_number",
      "error": "Duplicate invoice number",
      "value": "INV-2024-001"
    }
  ]
}
```

---

## NATS Integration

### Publisher (Upload Controller)
```javascript
await natsClient.publish('upload.process', {
  upload_id: uploadId,
  workspace_id: workspaceId,
  upload_type: uploadType
});
```

### Subscriber (Processor Service)
```javascript
natsClient.subscribe('upload.process', async (msg) => {
  const { upload_id } = msg.data;
  await processUpload(upload_id);
});
```

---

## File Storage

### Directory Structure
```
/uploads/
  ├── {workspace_id}/
  │   ├── {gstin_id}/
  │   │   ├── {period_code}/
  │   │   │   ├── {upload_id}_gstr2b.csv
  │   │   │   └── {upload_id}_purchase.xlsx
```

### Volume Mount (Docker)
```yaml
volumes:
  - ./uploads:/app/uploads
```

---

## API Gateway Configuration

```yaml
http:
  routers:
    upload-service:
      rule: "Host(`api.gsttool.com`) && PathPrefix(`/uploads`)"
      service: upload-service
      middlewares:
        - auth-middleware
```

---

## Dependencies

```json
{
  "multer": "^1.4.5-lts.1",
  "csv-parser": "^3.0.0",
  "xlsx": "^0.18.5",
  "papaparse": "^5.4.1",
  "nats": "^2.15.0"
}
```

---

## Environment Variables

```env
UPLOAD_DIR=/app/uploads
MAX_FILE_SIZE=52428800  # 50MB
ALLOWED_FILE_TYPES=csv,xlsx,xls,json
NATS_URL=nats://nats:4222
```

---

## Verification Tests

1. Upload GSTR2B CSV file
2. Upload Purchase Register Excel file
3. List uploads with filters
4. Get upload details
5. Retry failed upload
6. Verify async processing
7. Check error handling
8. Validate file storage

---

**Status**: ⏳ **Ready for Implementation**
