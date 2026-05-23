-- =========================================================================
-- EXTERNAL GST INTEGRATION SERVICE - DATABASE SCHEMA
-- =========================================================================
-- Enable essential extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =========================================================================
-- SECTION 1: CORE CLIENT & ACCESS MANAGEMENT
-- Based on the new structure from Adesk-Menu.xlsx
-- =========================================================================

-- 1.1 Access Keys (Third-party clients / platforms)
CREATE TABLE IF NOT EXISTS api_conn_access_key (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform                VARCHAR(50),
    client_name             VARCHAR(200),
    contact_email           VARCHAR(255),
    third_party_unique_id   VARCHAR(100),
    app_secret_key          VARCHAR(255) UNIQUE,
    production_key          VARCHAR(255) UNIQUE,
    sandbox_key             VARCHAR(255) UNIQUE,
    mode                    VARCHAR(20),       -- e.g., SANDBOX / PRODUCTION
    status                  VARCHAR(50),       -- active / inactive
    metadata                JSONB,
    created_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 1.2 GST Master (GSTINs registered by clients)
CREATE TABLE IF NOT EXISTS api_conn_gst_master (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    gstn                    VARCHAR(15) NOT NULL,
    legal_name              VARCHAR(500),
    gst_user_name           VARCHAR(50),
    trade_name              VARCHAR(500),
    registration_type       VARCHAR(50),
    registration_date       DATE,
    cancellation_date       DATE,
    state_code              VARCHAR(2),
    center_jurisdiction     VARCHAR(200),
    state_jurisdiction      VARCHAR(200),
    business_nature         VARCHAR(255),
    contact_person          VARCHAR(100),
    contact_email           VARCHAR(255),
    contact_phone           VARCHAR(20),
    address                 JSONB,
    gstin_pwd_encrypted     TEXT,
    password_updated_at     TIMESTAMPTZ,
    gstin_status            VARCHAR(50),
    is_active               BOOLEAN DEFAULT TRUE,
    compliance_score        NUMERIC,
    last_filing_date        DATE,
    next_filing_due_date    DATE,
    metadata                JSONB,
    platform                VARCHAR(50),
    gst_last_fetch_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 1.3 Allowed Access (API limits & service flags)
CREATE TABLE IF NOT EXISTS api_conn_allowed_access (
    id                              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key                         VARCHAR(255),
    service_gst                     BOOLEAN DEFAULT FALSE,
    total_gst_api_call              INTEGER DEFAULT 0,
    consume_gst_api_call            INTEGER DEFAULT 0,
    remaining_gst_api_call          INTEGER DEFAULT 0,
    service_eway_bill               BOOLEAN DEFAULT FALSE,
    total_eway_bill_api_call        INTEGER DEFAULT 0,
    consume_eway_bill_api_call      INTEGER DEFAULT 0,
    remaining_eway_bill_api_call    INTEGER DEFAULT 0,
    service_einvoice                BOOLEAN DEFAULT FALSE,
    total_einvoice_api_call         INTEGER DEFAULT 0,
    consume_einvoice_api_call       INTEGER DEFAULT 0,
    remaining_einvoice_api_call     INTEGER DEFAULT 0,
    status                          VARCHAR(50),
    subscription_end_date           TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 1.4 API Access Log
CREATE TABLE IF NOT EXISTS api_conn_api_access_log (
    id                              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_conn_allowed_access_id      UUID        REFERENCES api_conn_allowed_access(id) ON DELETE SET NULL,
    api_key                         VARCHAR(255),
    server_ip                       VARCHAR(45),
    api_name                        VARCHAR(100),
    api_cat                         VARCHAR(50),
    request_params                  JSONB,
    resposne_params                 JSONB,
    status                          VARCHAR(50),
    request_header                  JSONB,
    action_by                       VARCHAR(100),
    metadata                        JSONB,
    platform                        VARCHAR(50),
    added_at                        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 1.5 Subscription Log
CREATE TABLE IF NOT EXISTS api_conn_subscription_log (
    id                              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name                     VARCHAR(200),
    contact_email                   VARCHAR(255),
    platform                        VARCHAR(50),
    start_date                      TIMESTAMPTZ,
    end_date                        TIMESTAMPTZ,
    status                          VARCHAR(50),
    subscription_type               VARCHAR(50),
    api_cat                         VARCHAR(50),
    created_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================================
-- SECTION 2: GST PORTAL AUTH SESSION (OTP Flow per GSTIN)
-- =========================================================================

CREATE TABLE IF NOT EXISTS ext_gstn_auth_sessions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    gst_master_id   UUID        NOT NULL REFERENCES api_conn_gst_master(id) ON DELETE CASCADE,
    gstin           CHAR(15)    NOT NULL,
    gst_username    VARCHAR(50) NOT NULL,
    otp_txn         VARCHAR(200),
    otp_requested_at TIMESTAMPTZ,
    auth_token      TEXT,
    token_expiry    TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (gstin, gst_username)
);
CREATE INDEX IF NOT EXISTS idx_ext_gstn_auth_gstin  ON ext_gstn_auth_sessions(gstin);
CREATE INDEX IF NOT EXISTS idx_ext_gstn_auth_expiry ON ext_gstn_auth_sessions(token_expiry);

-- =========================================================================
-- SECTION 3: PUBLIC TAXPAYER SEARCH CACHE (/public/search)
-- =========================================================================

CREATE TABLE IF NOT EXISTS ext_taxpayer_cache (
    gstin               CHAR(15)     PRIMARY KEY,
    legal_name          VARCHAR(500),
    trade_name          VARCHAR(500),
    taxpayer_status     VARCHAR(50),                  -- ACT, CNL, INA, PRO
    registration_type   VARCHAR(50),                  -- REGULAR, COMPOSITION, SEZ, etc.
    registration_date   DATE,
    cancellation_date   DATE,
    state_code          CHAR(2),
    center_jurisdiction VARCHAR(200),
    state_jurisdiction  VARCHAR(200),
    business_nature     JSONB,
    principal_address   JSONB,
    raw_response        JSONB        NOT NULL,
    cached_until        TIMESTAMPTZ  NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================================
-- SECTION 4: GST DATA FETCHED PER CLIENT+GSTIN
-- =========================================================================

-- 4.1 Return Tracking (/public/rettrack)
CREATE TABLE IF NOT EXISTS ext_return_track (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID        NOT NULL REFERENCES api_conn_access_key(id) ON DELETE CASCADE,
    gstin           CHAR(15)    NOT NULL,
    financial_year  CHAR(7)     NOT NULL,             -- YYYY-YY e.g. "2023-24"
    return_type     VARCHAR(20),                       -- R1, 3B, IFF, etc. NULL = all
    returns_data    JSONB       NOT NULL,              -- Full API response array
    cached_until    TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, gstin, financial_year, return_type)
);
CREATE INDEX IF NOT EXISTS idx_ext_return_track_lookup ON ext_return_track(client_id, gstin, financial_year);

-- 4.2 GSTR2B Data per Client (/gstr2b/get2b)
CREATE TABLE IF NOT EXISTS ext_gstr2b_data (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID        NOT NULL REFERENCES api_conn_access_key(id) ON DELETE CASCADE,
    gstin           CHAR(15)    NOT NULL,
    return_period   CHAR(6)     NOT NULL,             -- MMYYYY
    gen_date        DATE,                              -- GSTR2B file generation date
    raw_data        JSONB       NOT NULL,              -- Full GSTR2B payload
    cached_until    TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, gstin, return_period)
);
CREATE INDEX IF NOT EXISTS idx_ext_gstr2b_lookup ON ext_gstr2b_data(client_id, gstin, return_period);

-- =========================================================================
-- SECTION 5: E-INVOICE DATA PER CLIENT+GSTIN
-- =========================================================================

-- 5.1 IRN Registry - stores every IRN fetched for a client's GSTIN
CREATE TABLE IF NOT EXISTS ext_einvoice_irn (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id            UUID        NOT NULL REFERENCES api_conn_access_key(id) ON DELETE CASCADE,
    gstin                CHAR(15)    NOT NULL,
    irn                  CHAR(64)    NOT NULL,         -- 64-char IRN
    ack_number           BIGINT,
    ack_date             TIMESTAMPTZ,
    doc_number           VARCHAR(50) NOT NULL,
    doc_type             VARCHAR(10) NOT NULL,          -- INV, CRN, DBN
    doc_date             DATE        NOT NULL,
    ret_period           CHAR(6),                      -- MMYYYY
    supply_type          VARCHAR(20),                   -- B2B, SEZWP, EXPWP, etc.
    rstin_flag           CHAR(1),                       -- Y=by me, N=on me
    buyer_gstin          CHAR(15),
    buyer_name           VARCHAR(500),

    -- Financial summary
    taxable_value        NUMERIC(15,2),
    igst_amount          NUMERIC(15,2),
    cgst_amount          NUMERIC(15,2),
    sgst_amount          NUMERIC(15,2),
    cess_amount          NUMERIC(15,2),
    total_invoice_value  NUMERIC(15,2),

    -- Response data
    signed_invoice       TEXT,
    signed_qr_code       TEXT,
    status               VARCHAR(20)  DEFAULT 'ACTIVE',  -- ACTIVE, CANCELLED
    cancel_date          TIMESTAMPTZ,
    cancel_reason        VARCHAR(255),
    raw_response         JSONB,

    created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, irn)
);
CREATE INDEX IF NOT EXISTS idx_ext_einvoice_irn       ON ext_einvoice_irn(irn);
CREATE INDEX IF NOT EXISTS idx_ext_einvoice_gstin_doc ON ext_einvoice_irn(client_id, gstin, doc_number);
CREATE INDEX IF NOT EXISTS idx_ext_einvoice_period    ON ext_einvoice_irn(client_id, gstin, ret_period);

-- 5.2 E-Invoice HSN Summary per client (/gst/einvoice/hsnsum)
CREATE TABLE IF NOT EXISTS ext_einvoice_hsn_summary (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID        NOT NULL REFERENCES api_conn_access_key(id) ON DELETE CASCADE,
    gstin           CHAR(15)    NOT NULL,
    ret_period      CHAR(6)     NOT NULL,
    hsn_data        JSONB       NOT NULL,
    cached_until    TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, gstin, ret_period)
);

-- =========================================================================
-- SECTION 6: E-WAY BILL DATA PER CLIENT+GSTIN
-- =========================================================================

-- 6.1 E-Way Bill Registry
CREATE TABLE IF NOT EXISTS ext_ewaybill (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id            UUID        NOT NULL REFERENCES api_conn_access_key(id) ON DELETE CASCADE,
    gstin                CHAR(15)    NOT NULL,
    ewaybill_number      VARCHAR(15) NOT NULL,          -- 12-digit EWB number
    ewaybill_date        TIMESTAMPTZ,
    valid_until          TIMESTAMPTZ,

    -- Document
    doc_number           VARCHAR(50)  NOT NULL,
    doc_type             VARCHAR(10)  NOT NULL,          -- INV, BIL, BOE, CHL, OTH
    doc_date             DATE         NOT NULL,
    supply_type          CHAR(1),                       -- O=Outward, I=Inward

    -- Parties
    consignor_gstin      CHAR(15)     NOT NULL,
    consignor_name       VARCHAR(500),
    consignee_gstin      CHAR(15),
    consignee_name       VARCHAR(500),
    from_state           CHAR(2),
    to_state             CHAR(2),

    -- Financials
    taxable_value        NUMERIC(15,2),
    total_value          NUMERIC(15,2),
    igst_value           NUMERIC(15,2),
    cgst_value           NUMERIC(15,2),
    sgst_value           NUMERIC(15,2),
    cess_value           NUMERIC(15,2),

    -- Transport (Part A)
    transporter_gstin    CHAR(15),
    transporter_name     VARCHAR(200),
    trans_mode           CHAR(1),                       -- 1=Road, 2=Rail, 3=Air, 4=Ship
    trans_distance       INTEGER,

    -- Vehicle (Part B - latest)
    vehicle_number       VARCHAR(20),
    vehicle_type         CHAR(1),                       -- R=Regular, O=ODC

    -- Status
    status               VARCHAR(20)  DEFAULT 'ACTIVE', -- ACTIVE, CANCELLED, EXPIRED
    cancel_date          TIMESTAMPTZ,
    cancel_reason        VARCHAR(255),
    raw_response         JSONB,

    created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, ewaybill_number)
);
CREATE INDEX IF NOT EXISTS idx_ext_ewb_number    ON ext_ewaybill(ewaybill_number);
CREATE INDEX IF NOT EXISTS idx_ext_ewb_client    ON ext_ewaybill(client_id, gstin);
CREATE INDEX IF NOT EXISTS idx_ext_ewb_validity  ON ext_ewaybill(valid_until);
CREATE INDEX IF NOT EXISTS idx_ext_ewb_status    ON ext_ewaybill(status);

-- 6.2 E-Way Bill Vehicle Update Log (Part-B Updates)
CREATE TABLE IF NOT EXISTS ext_ewaybill_vehicle_log (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ewaybill_id          UUID        NOT NULL REFERENCES ext_ewaybill(id) ON DELETE CASCADE,
    ewaybill_number      VARCHAR(15) NOT NULL,
    vehicle_number       VARCHAR(20) NOT NULL,
    vehicle_type         CHAR(1),
    from_place           VARCHAR(100),
    from_state           CHAR(2),
    update_reason        SMALLINT,
    updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================================
-- SECTION 8: FILING PREFERENCES CACHE
-- =========================================================================
CREATE TABLE IF NOT EXISTS ext_preferences_cache (
    gstin           CHAR(15)    NOT NULL,
    financial_year  CHAR(7)     NOT NULL,
    preferences_data JSONB       NOT NULL,
    cached_until    TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (gstin, financial_year)
);
