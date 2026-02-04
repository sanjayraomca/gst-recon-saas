# confirmation_docs/phase_1/phase_1.1_auth.md

## Phase 1.1: Authentication & User Management (Keycloak Integration)

**Objective**: Implement the Authentication APIs defined in `postman.json` using **Keycloak**.

### 1. Shared Module (`services/shared`)
Contains **ONLY** generic utilities usable by all services.
*   `src/middleware/authMiddleware.js`: Generic JWT verification (validates token signature/expiry).
*   `src/db/connection.js`: Shared Knex connection.
*   `src/nats/client.js`: NATS client.
*   `src/utils/responseHandler.js`: Standard response format.

### 2. Tenant Service (`services/tenant-services`)
Hosts all **Keycloak-specific** business logic and User management.

**Folder Structure**:
*   `src/services/`
    *   **`keycloakService.js`**: Logic to interact with Keycloak Admin API (sync users, manage realm).
    *   **`authService.js`**: Orchestrates login (calls Keycloak) and verification.
*   `src/controllers/`
    *   `authController.js`: Endpoints for Login, Refresh, Profile.
*   `src/routes/`
    *   `authRoutes.js`: Route definitions.
*   `src/models/`
    *   `userModel.js`: Local `users` table operations.

**Configuration**:
*   Keycloak Realm: `gsttool`
*   Client: `admin-api`
*   Service depends on `keycloak` container.

### 3. Docker Configuration
*   Update `services/tenant-services` build context.
*   Ensure network connectivity between `tenant-service` and `keycloak`.

---
**Status**: Ready to Execute pending final confirmation.
