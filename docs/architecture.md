# Production Deployment Architecture

This document describes the design, security controls, and request flows of the production deployment architecture for the GST Tool application.

---

## 1. High-Level Architecture Diagram

```
                 +---------------------------------------+
                 |       Vercel Hosting Platform         |
                 |  +---------------------------------+  |
                 |  |      React Frontend Client      |  |
                 |  |       (app.mydomain.com)        |  |
                 |  +---------------------------------+  |
                 +-------------------+-------------------+
                                     |
                               HTTPS | Port 443
                                     v
+------------------------------------+------------------------------------+
|                       Production Server (VM Host)                        |
|                                                                         |
|   +-----------------------------------------------------------------+   |
|   |                       Traefik (TLS Edge Router)                 |   |
|   |                       - Terminates TLS/SSL                      |   |
|   |                       - Redirects HTTP to HTTPS                 |   |
|   +--------------------+---------------------+----------------------+   |
|                        |                     |                          |
|             Port 8002  |                     | Port 8080                |
|           (Internal)   |                     | (Internal)               |
|                        v                     v                          |
|             +----------+----------+   +------+------+                   |
|             |   Kong API Gateway  |   |   Keycloak  |                   |
|             |  (api.mydomain.com) |   | (Identity)  |                   |
|             +----------+----------+   +-------------+                   |
|                        |                                                |
|                        +------------------+                             |
|                                           | (Privately Routed)          |
|                                           v                             |
|   +---------------------------------------+-------------------------+   |
|   |  Internal Docker Bridge Network (gst-network)                    |   |
|   |                                                                 |   |
|   |  +-----------------+  +-----------------+  +-----------------+  |   |
|   |  | tenant-service  |  |workspace-service|  |  gstn-service   |  |   |
|   |  +--------+--------+  +--------+--------+  +--------+--------+  |   |
|   |           |                    |                    |           |   |
|   |           +---------+----------+----------+---------+           |   |
|   |                     |                     |                     |   |
|   |                     v                     v                     |   |
|   |             +-------+-------+     +-------+-------+             |   |
|   |             |  postgres-db  |     |   NATS Bus    |             |   |
|   |             | (Main DB Node)|     | (Event broker)|             |   |
|   |             +---------------+     +---------------+             |   |
|   |                                                                 |   |
|   |  +-----------------+  +-----------------+  +-----------------+  |   |
|   |  | upload-service  |  | report-service  |  |notification-srv |  |   |
|   |  +--------+--------+  +-----------------+  +--------+--------+  |   |
|   |           |                                         |           |   |
|   |           v (Private S3 connection)                 v           |   |
|   |     +-----+-----+                             +-----+-----+     |   |
|   |     |   MinIO   |                             |  Mailhog  |     |   |
|   |     | (Storage) |                             |  (SMTP)   |     |   |
|   |     +-----------+                             +-----------+     |   |
|   +-----------------------------------------------------------------+   |
+-------------------------------------------------------------------------+
```

---

## 2. Key Component Configurations

### Traefik Reverse Proxy (Edge)
- Acts as the single entrypoint on host ports `80` and `443`.
- Handles TLS certificate generation via Let's Encrypt and termintes SSL.
- Routes API traffic (`api.mydomain.com`) to the Kong API Gateway and Identity traffic (`auth.mydomain.com`) to Keycloak.

### Kong API Gateway (Internal)
- Runs in **DB-less mode** for configuration simplicity and resource optimization.
- Routes incoming public paths `/auth`, `/workspaces`, `/reconciliation`, etc. to the private container names and ports within the Docker bridge network.
- Limits exposure: Kong's Admin API port `8003` is NOT bound to the public internet, preventing administrative exploits.

### Docker Networking & Service Isolation
- A custom bridge network (`gst-network`) is configured.
- Database containers (`postgres-main`, `postgres-keycloak`), NATS message broker (`nats`), storage (`minio`), and email (`mailhog`) have their public `ports` removed. They are fully isolated from outside access and communicate securely via private container DNS.
- Microservices only listen internally within the bridge network. No direct client-to-service communication is possible without routing through Kong.

---

## 3. Production Security Implementations

### Cryptographic JWT Token Validation
1. When a user logs in, `tenant-service` interacts with Keycloak to authenticate credentials and issues an RS256 signed JWT access token.
2. The Vercel frontend client stores this token and includes it in all subsequent requests within the `Authorization: Bearer <token>` header.
3. Upon receiving requests, the microservices check if `KEYCLOAK_PUBLIC_KEY` is set in the environment variables. If present, the service performs a cryptographically secure verification of the RS256 signature using the Keycloak public key.
4. If valid, the request proceeds; otherwise, the middleware rejects it with a `403 Forbidden` response.

### CORS & Security Headers
- **CORS Mitigation**: Backend services restrict origins using the `FRONTEND_URL` environment variable configured in production, ensuring only requests from the authorized frontend client domain (`app.mydomain.com`) are allowed to interface with the APIs.
- **Reverse Proxy Headers**: Traefik injects standard headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) which are preserved by Kong and consumed by backend microservices to trace the true client IP and enforce secure transport (HTTPS).
- **Keycloak Edge Proxying**: Keycloak is configured with `KC_PROXY=edge` to respect the `X-Forwarded-*` headers injected by Traefik and properly construct redirection URLs matching the public domain name (`auth.mydomain.com`) instead of falling back to internal container DNS.

### Secrets Management
- All database passwords, API client keys, and JWT verification secrets are removed from files and configured dynamically via the environment variables (`.env`) on the host server.
- The values are safely interpolated by Docker Compose at container runtime.
