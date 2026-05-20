# Architecture & Implementation Plan: External GST Integration Service

This document provides a comprehensive technical overview of the newly engineered **External GST Integration Infrastructure** designed to serve as a high-performance, secure, and globally accessible API layer for multiple internal and external accounting softwares.

---

## 1. Executive Summary

Instead of coupling the GSP (GST Suvidha Provider) integration directly into our SaaS platform codebase, we have designed and built a **fully decoupled, standalone microservice** (`external-api-service`). 

### Key Business & Technical Benefits:
* **Multi-Client Portability**: Other billing applications, ERPs, or external accounting clients can consume this API using secure client API keys.
* **Cost & Performance Optimization**: Highly efficient caching keeps public searches and return tracks cached on our side, dramatically reducing White Book GSP query charges and avoiding rate limit blocks.
* **Credential Isolation**: Only this isolated service handles our direct GSP credentials (`client_id`, `client_secret`, and `email`). Clients only interact using transient API keys.

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
  │   [API Key Auth]  ───> [Log Auditing] ───> [Controller]│
  └────────────────────────────────────────────────────────┘
            │                                     │
       Cache Query                          Secure GSP Call
            ▼                                     ▼
  ┌──────────────────┐                  ┌──────────────────┐
  │ PostgreSQL Cache │                  │ White Book (GSP) │
  │ (ext_* tables)   │                  │ APIs (Sandbox)   │
  └──────────────────┘                  └──────────────────┘
```

---

## 3. Core Technical Mechanics

### A. Secure API Client Authentication
When a new client application joins, they run a one-time registration. The service returns a secure `64-character API Key` and stores it in the `ext_api_clients` table.
* Every subsequent request must present this key in the header (`X-API-Key: <key>`).
* The middleware validates the key in **~0-1ms** before any business logic executes.

### B. Smart Caching Layer
To optimize speed and GSP invoice costs, we implemented a server-side caching engine:
* **Public Searches (`/ext/gst/search`)**: Cached automatically in PostgreSQL for **24 hours**. If five different clients search the same GSTIN, only the first search hits the live GSP server; the remaining four are served locally in **~3ms**.
* **Return Trackings (`/ext/gst/rettrack`)**: Cached for **6 hours** per client to prevent unnecessary duplicate polling of filing tables.

### C. Persistent Auth & OTP Session Manager
For authenticated actions (downloading GSTR data or uploading filings), the taxpayer must log in with their portal username via OTP:
1. **Request OTP**: Service initiates OTP dispatch via GSP and returns a unique Transaction ID (`txn`).
2. **Verify OTP**: The client submits the OTP and `txn`. The service retrieves the GSP bearer token.
3. **Automatic Reuse**: The token is saved securely in the `ext_gstn_auth_sessions` table with a **6-hour expiry window**. Subsequent requests automatically fetch and attach this token backend-side, eliminating the need to prompt the taxpayer for an OTP on every interaction.

---

## 4. Database Schema Structure
The schema is built on **11 dedicated tables** inside PostgreSQL to ensure robust separation of records, history tracking, and strict multi-tenant security:

| Table | Category | Purpose |
|---|---|---|
| `ext_api_clients` | Client Management | Stores authorized apps, emails, API keys, and rate limits. |
| `ext_client_gstins` | Client Management | Links registered GSTINs & portal usernames to specific API clients. |
| `ext_gstn_auth_sessions` | Authentication | Caches OTP sessions and active GSP bearer tokens per GSTIN. |
| `ext_taxpayer_cache` | Shared Cache | Shared cache for public taxpayer details. |
| `ext_return_track` | GSTR Cache | Filing history and status logs. |
| `ext_gstr2b_data` | GSTR Cache | Full GSTR-2B JSON payloads per client. |
| `ext_einvoice_irn` | E-Invoice | Registry for generated IRNs, signed QR codes, and values. |
| `ext_einvoice_hsn_summary` | E-Invoice | HSN-wise summary records per tax period. |
| `ext_ewaybill` | E-Way Bill | EWB registry, including party, financials, and transport details. |
| `ext_ewaybill_vehicle_log` | E-Way Bill | Full tracking history for Part-B vehicle updates. |
| `ext_api_request_log` | Auditing | Universal log tracking caller IP, latency, HTTP status, and cache hits. |

---

## 5. Verification & Testing Status

We successfully deployed the database schema, started the node service locally on port `3008`, and verified the system using live sandbox requests:
* **Health Endpoint**: Status `UP`.
* **API Key Security**: Blocks missing or tampered keys with `401 Unauthorized`.
* **Taxpayer Search**: Real-time integration successfully returned official sandbox data (e.g. `WhiteBooks`, `Active` status, Tamil Nadu address) and cached it instantly.
* **Filing History**: Successfully hit the GSP track returns backend.
* **OTP Verification**: Dispatched OTP to mock taxpayer credentials successfully.
