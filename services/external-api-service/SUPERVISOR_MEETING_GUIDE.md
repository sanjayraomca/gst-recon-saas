# Supervisor Meeting Guide: GST Integration Architecture

Use this conversational presentation guide to explain the new architecture confidently and clearly in your next engineering meeting.

---

## 🗣️ Topic 1: The "Why" — Why We Chose a Standalone Microservice

### What to Say to Your Supervisor:
> "Instead of coupling the GSP (White Book) connection logic directly into our existing monolith, we built a fully decoupled, standalone microservice named `external-api-service` running in its own Docker container on **Port 3008**.
>
> We chose this architecture for three core reasons:
> 1. **Multi-Client Portability**: If we launch another billing system, an ERP, or a mobile app tomorrow, they can all call this service using simple API keys without rewriting GSP logic.
> 2. **Codebase Isolation**: Our main SaaS backend database and application logic remain completely clean and unaffected by GSP updates.
> 3. **Future Commercialization**: If we ever decide to package this GST integration layer as a standalone B2B product, we can extract this folder and deploy it as a separate commercial API product instantly."

---

## 🗣️ Topic 2: Security & The Intermediate Proxy Model

### What to Say to Your Supervisor:
> "We solved the problem of secure, multi-tenant credential management using an **Intermediate Proxy Model**:
> 
> * **Master GSP Credentials**: We own exactly one White Book sandbox account. The Client ID, Secret, and Developer Email are stored securely inside our server's `.env` file and are never stored in the database.
> * **API Client Tokens**: We issue custom, unique **64-character API Keys** to secondary client applications (stored in the `ext_api_clients` table).
> 
> When a client app requests data, the service validates their API Key in **under 1ms**. The service then connects to White Book on their behalf using our master credentials. The client never touches or sees our White Book credentials."

---

## 🗣️ Topic 3: Smart Caching Engine (Saving GSP API Fees)

### What to Say to Your Supervisor:
> "To prevent hitting government portal rate limits and to drastically reduce GSP transaction charges, we engineered a robust server-side caching engine:
>
> * **Public Searches (`/ext/gst/search`)**: When a client searches a GSTIN, we cache the parsed taxpayer details locally in our PostgreSQL database (`ext_taxpayer_cache`) for **24 hours**. If any other client searches the same GSTIN within 24 hours, our database serves the cached copy. **This takes 3ms instead of 600ms, and it costs us $0.00 since it bypasses the live GSP server.**
> * **Return Tracking (`/ext/gst/rettrack`)**: Filing statuses are cached for **6 hours** per client to prevent duplicate dashboard refreshes from spamming GSP rate limits."

---

## 🗣️ Topic 4: OTP Portal Login & Session Reusability

### What to Say to Your Supervisor:
> "For private data access (like pulling GSTR-2B or GSTR-2A), the portal requires a live OTP. Our service manages this state dynamically:
>
> 1. **OTP Request**: The client requests an OTP. Our service registers the request, obtains a GSP transaction ID (`txn`), and passes it back to the client.
> 2. **Verification**: The taxpayer enters the OTP sent to their phone. Our service verifies the OTP + `txn`, fetches the portal bearer token, and stores it in the `ext_gstn_auth_sessions` table.
> 3. **Automatic Session Reuse**: This token is valid for **6 hours**. For all subsequent GSTR pulls or filing actions, our service automatically retrieves this active token from the database. **The taxpayer only has to enter their OTP once every 6 hours, creating an incredibly smooth user experience.**"

---

## 🗣️ Topic 5: Live Testing & Current Project Status

### What to Say to Your Supervisor:
> "The database tables have been fully deployed inside our PostgreSQL container, and the Express service is up and running. 
> 
> We tested all endpoints live using White Book's official developer sandbox. Live searches, 24-hour cache hits, return tracking, and OTP request flows are all validated and functioning with 100% success. We are fully prepared to build out the front-end components and begin downloading GSTR-2A/2B reconciliations."
