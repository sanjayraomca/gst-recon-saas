# Phase 8: System Management & Admin Implementation Plan

## 1. Objective
Implement the System Management and Admin module to provide user customization, system-level alerts, background job scheduling, and comprehensive audit logging for compliance and monitoring.

## 2. Scope
*   **User Preferences**: Dashboard customization, notification settings, and display preferences.
*   **System Alerts**: Real-time alerts for critical events (ITC mismatches, filing deadlines, vendor non-compliance).
*   **Batch Jobs**: Scheduled background tasks for reports, reconciliation, and data cleanup.
*   **Audit Trail**: Immutable logging of all system actions for compliance and security.
*   **API Usage Tracking**: Passive monitoring of API calls for analytics and rate limiting.

## 3. Database Schema
Based on `FINAL_DB_SCHEMA_GST_TOOL.sql`.

### 3.1. `user_preferences`
*   **Purpose**: Stores user-specific UI and notification settings.
*   **Key Columns**:
    *   `user_id`, `workspace_id` (Composite unique)
    *   `default_dashboard_view` (Enum: ITC_SUMMARY, COMPLIANCE_SCORE, etc.)
    *   `visible_widgets` (Array)
    *   `email_notifications`, `in_app_notifications`, `sms_notifications` (Boolean)
    *   `notification_frequency` (Enum: REALTIME, DAILY, WEEKLY, NONE)
    *   `theme` (Enum: LIGHT, DARK, AUTO)
    *   `date_format`, `number_format`

### 3.2. `system_alerts`
*   **Purpose**: Stores system-generated alerts for users.
*   **Key Columns**:
    *   `alert_type` (Enum: VENDOR_NON_FILING, ITC_MISMATCH, NOTICE_RECEIVED, FILING_DUE, etc.)
    *   `severity` (Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO)
    *   `status` (Enum: ACTIVE, ACKNOWLEDGED, RESOLVED, DISMISSED)
    *   `related_entity_type`, `related_entity_id`
    *   `action_required` (Boolean)
    *   `action_taken`, `action_taken_by`, `action_taken_at`

### 3.3. `batch_jobs`
*   **Purpose**: Manages scheduled and background jobs.
*   **Key Columns**:
    *   `job_type` (Enum: RECONCILIATION, REPORT_GENERATION, DATA_IMPORT, NOTICE_GENERATION, VENDOR_SCORING, CLEANUP)
    *   `status` (Enum: PENDING, QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED, RETRYING)
    *   `priority` (1-10)
    *   `retry_count`, `max_retries`
    *   `scheduled_for`, `started_at`, `completed_at`
    *   `progress_percentage`, `progress_message`
    *   `job_parameters` (JSONB)
    *   `result_data`, `error_details` (JSONB)

### 3.4. `audit_trail`
*   **Purpose**: Immutable log of all system actions.
*   **Key Columns**:
    *   `entity_type`, `entity_id`
    *   `action`, `action_type` (Enum: CREATE, UPDATE, DELETE, VIEW, EXPORT, OVERRIDE, APPROVE, REJECT, LOCK, UNLOCK)
    *   `user_id`, `tenant_id`, `workspace_id`
    *   `old_values`, `new_values` (JSONB)
    *   `changed_fields` (Array)
    *   `ip_address`, `user_agent`
    *   `event_hash`, `previous_event_hash` (Hash chain for integrity)

### 3.5. `api_usage`
*   **Purpose**: Tracks API calls for analytics and rate limiting.
*   **Key Columns**:
    *   `api_endpoint`, `http_method`, `http_status_code`
    *   `request_size_bytes`, `response_size_bytes`, `processing_time_ms`
    *   `tenant_id`, `workspace_id`, `user_id`
    *   `success` (Boolean), `error_message`

## 4. API Endpoints
Based on `GST-Reconciliation-API.postman_collection.json`.

### 4.1. User Preferences
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/user/preferences` | Get user preferences |
| **PUT** | `/user/preferences` | Update user preferences |

### 4.2. System Alerts
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/alerts` | List alerts with filters (type, severity, status, date) |
| **POST** | `/alerts/{alert_id}/acknowledge` | Acknowledge/resolve alert |

### 4.3. Batch Jobs
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/batch-jobs` | List batch jobs with filters (type, status, date) |
| **POST** | `/batch-jobs` | Schedule new batch job |

### 4.4. Audit Trail
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/audit-trail` | View audit logs with filters (entity, user, action, date) |

## 5. Service Architecture
*   **Target Service**: Create new `admin-service` (Recommended) or extend `workspace-service`.
    *   *Recommendation*: Create dedicated `admin-service` for better separation of concerns and scalability.
    *   Audit Trail should be implemented as **middleware** that auto-captures all actions across services.
*   **Gateway Config**:
    *   Add routes `/user/preferences`, `/alerts`, `/batch-jobs`, `/audit-trail` to Kong Gateway.
*   **Job Queue**: Integrate job queue library (Bull, Agenda, or BullMQ) for batch job processing.

## 6. Implementation Order
1.  **Audit Trail** (Foundation) - Middleware for auto-logging
2.  **User Preferences** (Quick Win) - Simple CRUD
3.  **System Alerts** (Core Feature) - Requires trigger integration
4.  **Batch Jobs** (Complex) - Requires job queue setup
5.  **API Usage** (Passive) - Middleware-based tracking

## 7. Verification Plan
1.  **Schema Verification**: Ensure all 5 tables exist with correct constraints and indexes.
2.  **API Testing**: Use Postman collection to test all endpoints.
3.  **Audit Trail**: Verify all CRUD operations are logged automatically.
4.  **Alerts**: Trigger test scenarios (e.g., create mismatch) and verify alert generation.
5.  **Batch Jobs**: Schedule test job and verify execution, retry, and status updates.
6.  **Integration**: Verify user preferences apply to dashboard rendering.
