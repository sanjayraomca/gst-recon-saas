# Architecture & Implementation Plan: External GST, E-Invoice & E-Way Bill Integration Service

This document provides a comprehensive technical overview of the newly engineered **External Integration Infrastructure** designed to serve as a high-performance, secure, and globally accessible API layer for multiple internal and external accounting softwares.

---

## 1. Executive Summary

Instead of coupling the GSP (GST Suvidha Provider), E-Invoice, and E-Way Bill integrations directly into our SaaS platform codebase, we have designed and built a **fully decoupled, standalone microservice** (`external-api-service`).

### Key Business & Technical Benefits:
* **Multi-Client Portability**: Other billing applications, ERPs, or external accounting clients can consume this API using secure client API keys.
* **Cost & Performance Optimization**: Highly efficient caching keeps public taxpayer details, return tracks, and filing preferences cached on our side, dramatically reducing White Book GSP query charges and avoiding rate limit blocks.
* **Credential Isolation**: Only this isolated service handles our direct GSP credentials (`client_id`, `client_secret`, and `email`). Clients only interact using transient API keys.
* **Granular Library Authorization**: Access keys are restricted to specific authorized namespaces (`GST`, `EINVOICE`, `EWAYBILL`).

---

## 2. System Architecture

The following diagram illustrates the secure intermediate proxy model:

```
  ┌────────────────────────────────────────────────────────┐
  │ CLIENT APPLICATIONS                                    │
  │ (Our SaaS Platform, External ERPs, Billing Software)    │
  └────────────────────────────────────────────────────────┘
                              │
                    HTTPS Requests (X-API-Key)
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ EXTERNAL-API-SERVICE                                  │
  │ (Node.js/Express Middleware, Token Manager & Router)  │
  ├────────────────────────────────────────────────────────┤
  │   [API Key Auth]  ───> [Log Auditing] ───> [Router]    │
  └────────────────────────────────────────────────────────┘
            │                                     │
     Cache Query & Logic                    Secure GSP Call
            ▼                                     ▼
  ┌──────────────────┐                  ┌──────────────────┐
  │ PostgreSQL Cache │                  │ White Book (GSP) │
  │ (ext_* tables)   │                  │ APIs (Sandbox)   │
  └──────────────────┘                  └──────────────────┘
```

---

## 3. Core Technical Mechanics

### A. Secure API Client & Library Authentication
When a client application registers, they are assigned a secure `64-character API Key` and configuration parameters (like `rate_limit_per_minute` and `allowed_libs`).
* Every request must present this key in the header (`X-API-Key: <key>`).
* **Library Scoping**: Before resolving a route, the gateway validates that the client has the corresponding library in `allowed_libs` (e.g. `'GST'`, `'EINVOICE'`, or `'EWAYBILL'`). Unallowed calls are rejected with `403 Forbidden`.

### B. Smart Caching Layer (Least API Trigger System)
To prevent unnecessary API requests to the partner GSP, we implemented an optimized database caching architecture:
* **Taxpayer details (`/ext/gst/search`)**: Cached automatically in PostgreSQL for **7 days (168 hours)**.
* **Return Trackings (`/ext/gst/rettrack`)**: Cached for **48 hours** and **shared globally across all clients**. If Client A queries a GSTIN, Client B's query resolves instantly from the cache, preventing duplicate partner calls.
* **Filing Preferences (`/ext/gst/preferences`)**: Cached in PostgreSQL (`ext_preferences_cache`) for **7 days**.
* **E-Invoice HSN Summary (`/ext/einvoice/hsnsum`)**: Cached locally for **24 hours**.

### C. Persistent Auth & OTP Session Manager
For authenticated actions (downloading GSTR data or uploading filings), the taxpayer logs in with their portal username via OTP:
1. **Request OTP**: Service initiates OTP dispatch via GSP and returns a unique Transaction ID (`txn`).
2. **Verify OTP**: The client submits the OTP and `txn`. The service retrieves the GSP bearer token.
3. **Automatic Reuse**: The token is saved securely in the `ext_gstn_auth_sessions` table with a **6-hour expiry window**. Subsequent requests automatically fetch and attach this token backend-side.

---

## 4. Subsystem Routers & Endpoints

### 1. GST Subsystem (`/ext/gst/*`)
* `POST /ext/gst/clients`: Register client applications and generate keys.
* `POST /ext/gst/clients/gstins`: Register taxpayer GSTIN credentials.
* `GET /ext/gst/search`: Public taxpayer details search.
* `GET /ext/gst/rettrack`: Public return filing history tracking.
* `GET /ext/gst/preferences`: Public filing preferences fetch.
* `POST /ext/gst/auth/otp-request`: OTP session initiation.
* `POST /ext/gst/auth/verify-otp`: OTP verification.

### 2. E-Invoice Subsystem (`/ext/einvoice/*`)
* `POST /ext/einvoice/irn`: Generate E-Invoice (IRN, signed QR code, signed invoice payload) and store in database registry.
* `GET /ext/einvoice/irn/:irn`: Retrieve E-Invoice registration details by 64-char IRN.
* `POST /ext/einvoice/irn/cancel`: Cancel an active E-Invoice.
* `GET /ext/einvoice/hsnsum`: Get HSN-wise summary records.

### 3. E-Way Bill Subsystem (`/ext/ewaybill/*`)
* `POST /ext/ewaybill`: Generate E-Way Bill, validate transit distances, and record Part-A details.
* `GET /ext/ewaybill/:ewbNo`: Fetch details by 12-digit E-Way Bill Number.
* `POST /ext/ewaybill/cancel`: Cancel an active E-Way Bill.
* `POST /ext/ewaybill/vehicle`: Update vehicle details (Part B update) and log vehicle transition logs.

---

## 5. Database Schema Structure
The schema is built on **12 dedicated tables** inside PostgreSQL to ensure robust separation of records, history tracking, and strict multi-tenant security:

| Table | Category | Purpose |
|---|---|---|
| `ext_api_clients` | Client Management | Stores authorized apps, API keys, rate limits, and allowed libraries. |
| `ext_client_gstins` | Client Management | Links registered GSTINs & portal usernames to specific API clients. |
| `ext_gstn_auth_sessions` | Authentication | Caches OTP sessions and active GSP bearer tokens per GSTIN. |
| `ext_taxpayer_cache` | Shared Cache | Shared cache for public taxpayer details. |
| `ext_return_track` | GSTR Cache | Filing history and status logs. |
| `ext_preferences_cache` | Shared Cache | Filing frequency preferences cache (7 days TTL). |
| `ext_gstr2b_data` | GSTR Cache | Full GSTR-2B JSON payloads per client. |
| `ext_einvoice_irn` | E-Invoice | Registry for generated IRNs, signed QR codes, and values. |
| `ext_einvoice_hsn_summary` | E-Invoice | HSN-wise summary records per tax period. |
| `ext_ewaybill` | E-Way Bill | EWB registry, including party, financials, and transport details. |
| `ext_ewaybill_vehicle_log` | E-Way Bill | Full tracking history for Part-B vehicle updates. |
| `ext_api_request_log` | Auditing | Universal log tracking caller IP, latency, HTTP status, and cache hits. |

---

## 6. Verification & Testing Status

We successfully verified the service using local integration tests:
* **Decoupled Key Auth**: Verified security gateway blocks unauthorized library queries.
* **Caching Performance**: Verified `X-Cache: HIT` for duplicate taxpayer search, filing preferences, and return tracking.
* **E-Invoice / E-Way Bill Pipeline**: E-Invoice generation, cancellation, E-Way Bill generation, and vehicle update logging are fully functional and properly audited in the request log database.
