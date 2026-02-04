# confirmation_docs/phase_1/phase_1.2_workspace.md

## Phase 1.2: Workspace & Tenant Management

**Objective**: Implement Workspace and Tenant APIs as defined in `postman.json` (Phase 1.2).

### 1. Tenant Service (`services/tenant-services`)
Adding Tenant Management APIs.

**Files to be Updated/Created:**
*   `src/routes/tenantRoutes.js`:
    *   `POST /tenants`: Create a new tenant.
    *   `GET /tenants`: List tenants.
*   `src/controllers/tenantController.js`: Business logic.
*   `src/models/tenantModel.js`: Knex operations for `tenants` table.

### 2. Workspace Service (`services/workspace-services`)
**New Service** for Workspace operations.

**Files to be created:**
*   `package.json`: Dependencies.
*   `src/index.js`: Server setup, NATS connection.
*   `src/routes/workspaceRoutes.js`:
    *   `POST /workspaces`: Create workspace.
    *   `GET /workspaces`: List workspaces.
    *   `GET /workspaces/:id`: Get workspace details.
*   `src/controllers/workspaceController.js`: Business logic.
*   `src/models/workspaceModel.js`: Knex operations for `workspaces`.

### 3. API Gateway (`services/api-gateway/nginx.conf`)
*   Add routing for `/workspaces/` to `http://workspace-service:3003`.

### 4. Docker Configuration
*   Enable `workspace-service` in `docker-compose.yml`.
*   Ensure it connects to Postgres and NATS.

### 5. Postman Verification
*   Update `postman/phase_1_verify.json` (or create `phase_1.2_verify.json`) to test:
    *   Create Tenant (Admin)
    *   Create Workspace
    *   List Workspaces

### 6. Validation & Security (Technical Update)
*   **Header Requirement**: All workspace-specific endpoints MUST include `X-Workspace-ID`.
*   **UUID Strictness**: The `X-Workspace-ID` is validated against a strict UUID regex. Malformed IDs return `400 Bad Request`.
*   **Integrity**: Non-existent IDs return `404 Not Found` (handling FK violations gracefully).

---
**Status**: Waiting for Confirmation.
