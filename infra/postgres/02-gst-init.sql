-- Total: 65+ Tables consolidated from migrations

-- Enable essential extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Function to simulate v7 UUIDs for compatibility
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
BEGIN
    RETURN uuid_generate_v4();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DOMAIN 1: TENANCY & IDENTITY (6 tables)
-- ============================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id UUID, -- FK added later after users table is created
    tenant_code VARCHAR(50) UNIQUE NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    trading_name VARCHAR(255),
    pan CHAR(10),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    address JSONB,
    billing_account_id VARCHAR(100),
    subscription_plan VARCHAR(50) DEFAULT 'STARTER',
    subscription_status VARCHAR(20) DEFAULT 'ACTIVE' 
        CHECK (subscription_status IN ('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED')),
    trial_ends_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_code VARCHAR(100) NOT NULL, -- Unique per tenant
    UNIQUE (tenant_id, workspace_code),
    name VARCHAR(255) NOT NULL,
    gstn VARCHAR(20), -- Made nullable to support decoupling
    gstin_id UUID, -- Link to gstin_master
    legal_name VARCHAR(255),
    pan VARCHAR(20),
    email VARCHAR(255),
    filing_type VARCHAR(10) CHECK (filing_type IN ('m', 'q')),
    state VARCHAR(100),
    city VARCHAR(100),
    address TEXT,
    description TEXT,
    workspace_type VARCHAR(20) NOT NULL DEFAULT 'COMPANY'
        CHECK (workspace_type IN ('COMPANY', 'CA_FIRM', 'CONSULTANT', 'ENTERPRISE')),
    compliance_level VARCHAR(20) DEFAULT 'STANDARD'
        CHECK (compliance_level IN ('STANDARD', 'HIGH', 'AUDIT_READY')),
    industry_type VARCHAR(100),
    turnover_band VARCHAR(50),
    compliance_score INTEGER DEFAULT 0,
    last_activity TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB DEFAULT '{
        "auto_reconcile": true,
        "notify_on_mismatch": true,
        "lock_period_after_filing": true,
        "allow_manual_overrides": true,
        "reconciliation_tolerance": 1.0
    }',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

-- Note: FK for gstin_id added after gstin_master if needed or keeping it loose

CREATE TABLE tenant_workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    access_type VARCHAR(20) NOT NULL DEFAULT 'OWNER'
        CHECK (access_type IN ('OWNER', 'COLLABORATOR', 'VIEWER')),
    invitation_token VARCHAR(100),
    invitation_email VARCHAR(255),
    invitation_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (invitation_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
    invited_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    invited_by UUID,
    accepted_at TIMESTAMPTZ,
    removed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, workspace_id)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    phone VARCHAR(20),
    phone_verified BOOLEAN DEFAULT FALSE,
    full_name VARCHAR(255) NOT NULL,
    designation VARCHAR(100),
    profile_image_url TEXT,
    auth_provider_id VARCHAR(255),
    auth_provider_type VARCHAR(50) DEFAULT 'KEYCLOAK',
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(100),
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    login_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    reset_password_token VARCHAR(255),
    reset_password_expires_at TIMESTAMPTZ,
    invitation_token VARCHAR(255),
    invitation_expires_at TIMESTAMPTZ,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspace_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL
        CHECK (role IN ('SUPER_ADMIN', 'WORKSPACE_ADMIN', 'ACCOUNTANT', 
                       'AUDITOR', 'VIEWER', 'GST_PRACTITIONER', 'TENANT_ADMIN')),
    permissions JSONB DEFAULT '{
        "can_upload": true,
        "can_reconcile": true,
        "can_override": false,
        "can_export": true,
        "can_invite": false,
        "can_configure": false
    }',
    invitation_status VARCHAR(20) DEFAULT 'ACTIVE'
        CHECK (invitation_status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED', 'PENDING')),
    invited_by UUID REFERENCES users(id),
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMPTZ,
    UNIQUE (workspace_id, user_id)
);

CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    tenant_id UUID,
    workspace_id UUID,
    action_type VARCHAR(50) NOT NULL, -- login, tenant_registered, create_org, etc.
    activity_type VARCHAR(100),       -- platform details (e.g. Zoho, TallyPrime)
    entity_type VARCHAR(50) NOT NULL, -- User, Tenant, Organization, etc.
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_user ON activity_logs (user_id);
CREATE INDEX idx_activity_tenant ON activity_logs (tenant_id);
CREATE INDEX idx_activity_workspace ON activity_logs (workspace_id);
CREATE INDEX idx_activity_action ON activity_logs (action_type);
CREATE INDEX idx_activity_created ON activity_logs (created_at);

CREATE TABLE third_party_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    platform VARCHAR(100) NOT NULL,
    last_login_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_third_party_users_email ON third_party_users (email);

-- Add foreign key constraint for tenant ownership (after users table exists)
ALTER TABLE tenants ADD CONSTRAINT fk_tenants_owner 
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Performance indexes for multi-tenant queries
CREATE INDEX idx_tenants_owner ON tenants(owner_user_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_workspace_users_user ON workspace_users(user_id);
CREATE INDEX idx_workspace_users_workspace ON workspace_users(workspace_id);
CREATE INDEX idx_workspace_users_role ON workspace_users(role);


-- ============================================
-- DOMAIN 2: GST MASTER DATA (6 tables)
-- ============================================

CREATE TABLE gstin_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gstin CHAR(15) UNIQUE NOT NULL,
    legal_name VARCHAR(500) NOT NULL,
    gst_user_name VARCHAR(50) DEFAULT NULL,
    trade_name VARCHAR(500),
    registration_type VARCHAR(30) NOT NULL
        CHECK (registration_type IN ('REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'ISD', 'CASUAL')),
    registration_date DATE,
    cancellation_date DATE,
    state_code CHAR(2) NOT NULL,
    center_jurisdiction VARCHAR(100),
    state_jurisdiction VARCHAR(100),
    business_nature VARCHAR(200),
    contact_person VARCHAR(200),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    address JSONB,
    gstin_pwd_encrypted TEXT,
    password_updated_at TIMESTAMPTZ,
    gstin_status VARCHAR(20) DEFAULT 'ACTIVE',
    is_active BOOLEAN DEFAULT TRUE,
    compliance_score NUMERIC(5,2) DEFAULT 100.00,
    last_filing_date DATE,
    next_filing_due_date DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    gst_last_fetch_at TIMESTAMPTZ DEFAULT NULL,
    platform VARCHAR(100) DEFAULT NULL
);

CREATE TABLE supplier_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    supplier_code VARCHAR(100),
    supplier_name VARCHAR(500) NOT NULL,
    gstin CHAR(15),
    pan CHAR(10),
    contact_person VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(20),
    address JSONB,
    supplier_type VARCHAR(30) DEFAULT 'REGULAR'
        CHECK (supplier_type IN ('REGULAR', 'RCM', 'SEZ', 'EXPORT', 'UNREGISTERED')),
    risk_category VARCHAR(20) DEFAULT 'MEDIUM'
        CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED')),
    filing_consistency_score NUMERIC(5,2) DEFAULT 100.00,
    avg_invoice_value NUMERIC(15,2),
    total_transactions INTEGER DEFAULT 0,
    total_transaction_value NUMERIC(15,2) DEFAULT 0,
    last_transaction_date DATE,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    customer_code VARCHAR(100),
    customer_name VARCHAR(500) NOT NULL,
    gstin CHAR(15),
    pan CHAR(10),
    contact_person VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(20),
    address JSONB,
    customer_type VARCHAR(30) DEFAULT 'REGULAR'
        CHECK (customer_type IN ('REGULAR', 'SEZ', 'EXPORT', 'UNREGISTERED')),
    risk_category VARCHAR(20) DEFAULT 'MEDIUM'
        CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED')),
    filing_consistency_score NUMERIC(5,2) DEFAULT 100.00,
    avg_invoice_value NUMERIC(15,2),
    total_transactions INTEGER DEFAULT 0,
    total_transaction_value NUMERIC(15,2) DEFAULT 0,
    last_transaction_date DATE,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE financial_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fy_code VARCHAR(9) NOT NULL UNIQUE,
    display_name VARCHAR(50),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tax_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fy_id UUID NOT NULL REFERENCES financial_years(id),
    period_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
        CHECK (period_type IN ('MONTHLY', 'QUARTERLY', 'ANNUAL')),
    month INTEGER CHECK (month >= 1 AND month <= 12),
    quarter INTEGER CHECK (quarter >= 1 AND quarter <= 4),
    year INTEGER NOT NULL,
    period_code VARCHAR(7) NOT NULL UNIQUE,
    display_name VARCHAR(50),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    filing_due_date DATE,
    is_locked BOOLEAN DEFAULT FALSE,
    locked_at TIMESTAMPTZ,
    locked_by UUID REFERENCES users(id),
    locking_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE hsn_sac_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(10) NOT NULL,
    code_type VARCHAR(3) DEFAULT 'HSN'
        CHECK (code_type IN ('HSN', 'SAC')),
    description TEXT NOT NULL,
    chapter VARCHAR(5),
    gst_rate NUMERIC(4,2),
    is_service BOOLEAN DEFAULT FALSE,
    itc_blocked BOOLEAN DEFAULT FALSE,
    itc_blocking_section VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (code, code_type)
);

-- ============================================
-- DOMAIN 2.1: SIMPLIFIED STATE MASTER
-- ============================================

CREATE TABLE state_code_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state VARCHAR(100) UNIQUE NOT NULL,
    code CHAR(2) UNIQUE NOT NULL
);

-- ============================================
-- DOMAIN 4.1: GSTR-2B RESTRUCTURED (Partitioned)
-- ============================================


CREATE OR REPLACE FUNCTION clean_invoice_number(inv_num text) RETURNS text AS $$
BEGIN
    -- Remove special chars, spaces, and leading zeros
    RETURN ltrim(regexp_replace(upper(inv_num), '[^A-Z0-9]', '', 'g'), '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;



CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(50),
    record_id UUID, -- Can't FK nicely to partitioned tables
    action VARCHAR(20), -- UPDATE
    old_value JSONB,
    new_value JSONB,
    modified_by VARCHAR(100) NULL,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
DECLARE
    old_val jsonb;
    new_val jsonb;
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        old_val = to_jsonb(OLD);
        new_val = to_jsonb(NEW);
        INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, modified_at)
        VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', old_val, new_val, NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;






-- ============================================
-- DOMAIN 8: AUDIT, COMPLIANCE & NOTICES (9 tables)
-- ============================================

CREATE TABLE audit_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID,
    workspace_id UUID,
    gstin_id UUID,
    user_id UUID REFERENCES users(id),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    action_type VARCHAR(20) NOT NULL
        CHECK (action_type IN ('CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 
                              'OVERRIDE', 'APPROVE', 'REJECT', 'LOCK', 'UNLOCK')),
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    change_reason VARCHAR(200),
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),
    session_id VARCHAR(100),
    event_hash CHAR(64) NOT NULL,
    previous_event_hash CHAR(64),
    hash_chain_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);



CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL
        CHECK (document_type IN ('INVOICE_PDF', 'PAYMENT_PROOF', 'BOE', 'NOTICE', 
                                'CHALLAN', 'CONTRACT', 'LETTER', 'CERTIFICATE', 'OTHER')),
    file_name VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(500),
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100),
    file_hash CHAR(64) NOT NULL,
    storage_path TEXT,
    storage_provider VARCHAR(50) DEFAULT 'S3',
    title VARCHAR(500),
    description TEXT,
    tags TEXT[],
    linked_entity_type VARCHAR(50),
    linked_entity_id UUID,
    is_encrypted BOOLEAN DEFAULT TRUE,
    encryption_key_id VARCHAR(100),
    access_control JSONB DEFAULT '{
        "public": false,
        "allowed_roles": ["WORKSPACE_ADMIN", "ACCOUNTANT", "AUDITOR"]
    }',
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

-- ============================================
-- NEW: Vendor Communications (1 table)
-- ============================================


-- ============================================
-- NEW: Cash Flow Impact (1 table)
-- ============================================



-- ============================================
-- DOMAIN 9: ALERTS & RULES (3 tables)
-- ============================================







-- ============================================
-- TRIGGER FOR AUTO-UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at column
DO $$ 
DECLARE 
    tbl RECORD;
BEGIN
    FOR tbl IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
        AND table_name NOT IN ('audit_trail', 'raw_json_snapshots') -- These are append-only
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%s_updated_at ON %I;
            CREATE TRIGGER update_%s_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', tbl.table_name, tbl.table_name, tbl.table_name, tbl.table_name);
    END LOOP;
END $$;

-- ============================================
-- INITIAL DATA SEEDING
-- ============================================


-- Insert accurate GST State/UT codes
INSERT INTO state_code_master (state, code) VALUES
('Jammu and Kashmir', '01'),
('Himachal Pradesh', '02'),
('Punjab', '03'),
('Chandigarh', '04'),
('Uttarakhand', '05'),
('Haryana', '06'),
('Delhi', '07'),
('Rajasthan', '08'),
('Uttar Pradesh', '09'),
('Bihar', '10'),
('Sikkim', '11'),
('Arunachal Pradesh', '12'),
('Nagaland', '13'),
('Manipur', '14'),
('Mizoram', '15'),
('Tripura', '16'),
('Meghalaya', '17'),
('Assam', '18'),
('West Bengal', '19'),
('Jharkhand', '20'),
('Odisha', '21'),
('Chhattisgarh', '22'),
('Madhya Pradesh', '23'),
('Gujarat', '24'),
('Dadra and Nagar Haveli and Daman and Diu', '26'),
('Maharashtra', '27'),
('Andhra Pradesh', '28'),
('Karnataka', '29'),
('Goa', '30'),
('Lakshadweep', '31'),
('Kerala', '32'),
('Tamil Nadu', '33'),
('Puducherry', '34'),
('Andaman and Nicobar Islands', '35'),
('Telangana', '36'),
('Andhra Pradesh (New)', '37'),
('Ladakh', '38')
ON CONFLICT (state) DO NOTHING;

-- ============================================
-- SUPERADMIN SEEDING
-- ============================================

/*
DO $$ 
DECLARE 
    v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
    v_workspace_id UUID := '00000000-0000-0000-0000-000000000002';
    v_user_id UUID;
    v_email TEXT := 'superadmin.dev@gmail.com';
BEGIN
    -- 1. Insert Default Tenant
    INSERT INTO tenants (id, tenant_code, legal_name, subscription_plan, subscription_status)
    VALUES (v_tenant_id, 'SYSTEM_TENANT', 'System Administration', 'ENTERPRISE', 'ACTIVE')
    ON CONFLICT (tenant_code) DO NOTHING;

    -- 2. Insert Default Workspace
    INSERT INTO workspaces (id, tenant_id, workspace_code, name, workspace_type, compliance_level)
    VALUES (v_workspace_id, v_tenant_id, 'SYSTEM_WS', 'System Workspace', 'ENTERPRISE', 'AUDIT_READY')
    ON CONFLICT (tenant_id, workspace_code) DO NOTHING;

    -- 3. Ensure User Exists and get ID
    -- We try to use a fixed ID for consistency in fresh installs, but handle existing emails
    INSERT INTO users (id, email, full_name, auth_provider_type, is_active, tenant_id)
    VALUES ('00000000-0000-0000-0000-000000000003', v_email, 'Dev SuperAdmin', 'KEYCLOAK', TRUE, v_tenant_id)
    ON CONFLICT (email) DO UPDATE SET is_active = EXCLUDED.is_active
    RETURNING id INTO v_user_id;

    -- 4. Link User to Workspace with SUPER_ADMIN role
    INSERT INTO workspace_users (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user_id, 'SUPER_ADMIN')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;

    -- 5. Update Tenant Owner
    UPDATE tenants SET owner_user_id = v_user_id WHERE id = v_tenant_id AND (owner_user_id IS NULL OR owner_user_id != v_user_id);
END $$;
*/

-- ============================================
-- DOMAIN 11: GSTR IMPORT & RECONCILIATION
-- ============================================

-- Master Table for File Imports
CREATE TABLE IF NOT EXISTS gstr_import_master (
    import_filing_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_uuid UUID NOT NULL,
    workspace_id UUID,                              -- Task 1: workspace association
    gstin_recipient VARCHAR(15) NOT NULL,
    return_period VARCHAR(255) NOT NULL,
    financial_year VARCHAR(50) NOT NULL,
    generation_date DATE NOT NULL,
    upload_timestamp TIMESTAMP DEFAULT NOW(),
    import_type VARCHAR(20) NOT NULL
        CHECK (import_type IN ('GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B', 'GSTR4', 'GSTR6', 'GSTR7', 'GSTR8', 'GSTR9', 'GSTR9C', 'SALES_REGISTER', 'PURCHASE_REGISTER')),
    original_filename VARCHAR(500),
    uploaded_filepath TEXT,
    uploaded_file_url TEXT,
    extra_info JSONB DEFAULT '{}',

    -- Task 7: Upgraded status lifecycle
    status VARCHAR(20) DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Processing', 'Normalizing', 'Completed', 'PartiallyCompleted', 'Failed')),
    status_message TEXT,                            -- Human-readable status detail
    started_at TIMESTAMP,
    completed_at TIMESTAMP,

    -- Task 6: Per-section import summary counters
    total_record INTEGER DEFAULT 0,                 -- Total records across all sections
    total_b2b INTEGER DEFAULT 0,
    total_b2ba INTEGER DEFAULT 0,
    total_cdnr INTEGER DEFAULT 0,
    total_cdnra INTEGER DEFAULT 0,
    total_impg INTEGER DEFAULT 0,
    total_isd INTEGER DEFAULT 0,
    total_normalized INTEGER DEFAULT 0,

    imported_by UUID,
    user_email VARCHAR(255),
    file_hash VARCHAR(64)                           -- MD5 hash for exact duplicate detection
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gstr_import_tenant    ON gstr_import_master(tenant_uuid);
CREATE INDEX IF NOT EXISTS idx_gstr_import_workspace ON gstr_import_master(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gstr_import_gstin     ON gstr_import_master(gstin_recipient);
CREATE INDEX IF NOT EXISTS idx_gstr_import_period    ON gstr_import_master(return_period);
CREATE INDEX IF NOT EXISTS idx_gstr_import_status    ON gstr_import_master(status);
CREATE INDEX IF NOT EXISTS idx_gstr_import_timestamp ON gstr_import_master(upload_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gstr_import_type      ON gstr_import_master(import_type);
CREATE INDEX IF NOT EXISTS idx_gstr_import_filing_id ON gstr_import_master(import_filing_id);

-- Foreign key constraints
ALTER TABLE gstr_import_master
    ADD CONSTRAINT fk_gstr_import_tenant
    FOREIGN KEY (tenant_uuid) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE gstr_import_master
    ADD CONSTRAINT fk_gstr_import_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE gstr_import_master
    ADD CONSTRAINT fk_gstr_import_user
    FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;

-- Detail Table for GSTR-2B B2B Invoices
CREATE TABLE IF NOT EXISTS gstr_2b_b2b_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,                 -- Links to the file upload master
    tenant_id UUID NOT NULL,                        -- Tenant isolation
    workspace_id UUID,                              -- Optional workspace association
    gstin_supplier VARCHAR(15) NOT NULL,            -- 24AALFA...
    trade_name VARCHAR(255),                        -- Supplier Name
    
    -- Invoice Details
    invoice_number_raw VARCHAR(100),                -- Original invoice number as-is from the Excel sheet
    invoice_number VARCHAR(50) NOT NULL,            -- Cleaned/normalized for matching

    invoice_type VARCHAR(20),                       -- Regular, SEZWP, etc.
    invoice_date DATE NOT NULL,
    return_period VARCHAR(255),                      -- e.g. "122025" — used in duplicate detection unique constraint
    invoice_value NUMERIC(15, 2),                   -- Total Invoice Value
    place_of_supply VARCHAR(100),                   -- e.g. "24-Gujarat"
    reverse_charge VARCHAR(5) DEFAULT 'No',         -- "Yes" or "No" (kept as string for raw fidelity)
    
    -- Tax Amounts (Using NUMERIC for financial precision)
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    -- Compliance Meta
    supplier_filing_period VARCHAR(255),             -- e.g. "Dec-2025"
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',      -- "Yes" / "No"
    itc_availability_reason TEXT,                   -- If No, why?
    applicable_tax_rate VARCHAR(255),                -- e.g. "18.00" or "100%" (Stored as string to preserve source format)
    
    -- E-Invoice Data
    source VARCHAR(50),                             -- e.g. "E-Invoice"
    irn VARCHAR(100),                               -- Invoice Reference Number (Hash)
    irn_date DATE,

    -- Reconciliation Status
    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    -- Audit Columns
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT fk_gstr_b2b_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_b2b_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_b2b_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,

    -- Unique constraint to prevent duplicate invoices across imports for the same tenant/period
    CONSTRAINT uq_gstr_b2b_invoice
        UNIQUE (tenant_id, invoice_number, return_period)
);

-- Add Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_gstr_b2b_import_filing_id ON gstr_2b_b2b_invoices(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_gstr_b2b_tenant_id ON gstr_2b_b2b_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_b2b_workspace_id ON gstr_2b_b2b_invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gstr_b2b_gstin ON gstr_2b_b2b_invoices(gstin_supplier);
CREATE INDEX IF NOT EXISTS idx_gstr_b2b_invoice_date ON gstr_2b_b2b_invoices(invoice_date);

-- Attach the Auto-Update Trigger
DROP TRIGGER IF EXISTS update_gstr_2b_b2b_invoices_updated_at ON gstr_2b_b2b_invoices;
CREATE TRIGGER update_gstr_2b_b2b_invoices_updated_at
BEFORE UPDATE ON gstr_2b_b2b_invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
-- Migration: Add GSTR-2B Amendments (B2BA) and Credit/Debit Notes (CDNR) tables
-- Date: 2026-02-18

-- Detail Table for GSTR-2B B2BA (Amendments)
CREATE TABLE IF NOT EXISTS gstr_2b_b2ba_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    
    -- Original Invoice Details
    original_invoice_number VARCHAR(50) NOT NULL,
    original_invoice_date DATE NOT NULL,
    
    -- Revised Invoice Details
    revised_invoice_number VARCHAR(50) NOT NULL,
    revised_invoice_date DATE NOT NULL,
    
    invoice_type VARCHAR(20),
    return_period VARCHAR(255),
    invoice_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    
    -- Tax Amounts
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    -- Compliance Meta
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    is_amended BOOLEAN DEFAULT TRUE,

    -- Reconciliation Status
    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gstr_b2ba_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_b2ba_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_b2ba_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,
    UNIQUE(tenant_id, original_invoice_number, revised_invoice_number, return_period)
);

CREATE INDEX IF NOT EXISTS idx_gstr_b2ba_import_filing_id ON gstr_2b_b2ba_invoices(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_gstr_b2ba_tenant_id ON gstr_2b_b2ba_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_b2ba_gstin ON gstr_2b_b2ba_invoices(gstin_supplier);

-- Detail Table for GSTR-2B CDNR (Credit/Debit Notes)
CREATE TABLE IF NOT EXISTS gstr_2b_cdnr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    
    -- Note Details
    note_type VARCHAR(255),                          -- Credit / Debit
    note_number VARCHAR(50) NOT NULL,
    note_date DATE NOT NULL,
    original_invoice_number VARCHAR(50),
    original_invoice_date DATE,
    
    return_period VARCHAR(255),
    note_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    
    -- Tax Amounts
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    -- Compliance Meta
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),

    -- Reconciliation Status
    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gstr_cdnr_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_cdnr_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_cdnr_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,
    UNIQUE(tenant_id, note_number, return_period)
);

CREATE INDEX IF NOT EXISTS idx_gstr_cdnr_import_filing_id ON gstr_2b_cdnr(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_gstr_cdnr_tenant_id ON gstr_2b_cdnr(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_cdnr_gstin ON gstr_2b_cdnr(gstin_supplier);
-- Migration: Add GSTR-2B IMPG, ISD and CDNRA tables
-- Date: 2026-02-18

-- Imports of Goods (IMPG) table
CREATE TABLE IF NOT EXISTS gstr_2b_impg (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    
    port_code VARCHAR(255),
    boe_number VARCHAR(50) NOT NULL,
    boe_date DATE NOT NULL,
    return_period VARCHAR(255),
    icegate_ref_date DATE,
    
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),

    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gstr_impg_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_impg_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_impg_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,
    UNIQUE(tenant_id, boe_number, port_code, return_period)
);

-- Input Service Distributor (ISD) table
CREATE TABLE IF NOT EXISTS gstr_2b_isd (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    
    gstin_isd VARCHAR(15) NOT NULL,
    isd_name VARCHAR(255),
    document_type VARCHAR(20),       -- ISD Document / ISD Amendment
    document_number VARCHAR(50) NOT NULL,
    document_date DATE NOT NULL,
    return_period VARCHAR(255),
    
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    is_amended BOOLEAN DEFAULT FALSE,
    original_document_number VARCHAR(50),
    original_document_date DATE,

    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gstr_isd_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_isd_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_isd_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,
    UNIQUE(tenant_id, gstin_isd, document_number, return_period)
);

-- Amended Credit/Debit Notes (CDNRA) table
CREATE TABLE IF NOT EXISTS gstr_2b_cdnra (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    
    -- Original Note Details
    original_note_number VARCHAR(50) NOT NULL,
    original_note_date DATE NOT NULL,
    
    -- Revised Note Details
    revised_note_number VARCHAR(50) NOT NULL,
    revised_note_date DATE NOT NULL,
    note_type VARCHAR(255),
    
    original_invoice_number VARCHAR(50),
    original_invoice_date DATE,
    
    return_period VARCHAR(255),
    note_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    
    -- Tax Amounts
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    -- Compliance Meta
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    is_amended BOOLEAN DEFAULT TRUE,

    -- Reconciliation Status
    reconciliation_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gstr_cdnra_import_filing
        FOREIGN KEY (import_filing_id)
        REFERENCES gstr_import_master(import_filing_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_cdnra_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_gstr_cdnra_workspace
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE SET NULL,
    UNIQUE(tenant_id, original_note_number, revised_note_number, return_period)
);

CREATE INDEX IF NOT EXISTS idx_gstr_impg_tenant_id ON gstr_2b_impg(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_isd_tenant_id ON gstr_2b_isd(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_cdnra_tenant_id ON gstr_2b_cdnra(tenant_id);

-- ========================================================
-- DOMAIN 12: SALES & EXPENSE
-- Final Version
-- Includes:
--   - invoice_type
--   - Controlled book_type (SA, SR, CN, DN)
--   - Payment tracking
--   - round_off
--   - line_number
--   - is_rcm
--   - ITC tracking
--   - voucher_type
-- ========================================================

BEGIN;

-- ========================================================
-- 1️⃣ SALES_INVOICES
-- ========================================================

CREATE TABLE sales_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    tax_period_id UUID REFERENCES tax_periods(id),
    import_filing_id UUID REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,

    -- Invoice Classification
    invoice_type VARCHAR(20) NOT NULL
        CHECK (invoice_type IN (
            'B2B','B2C_SMALL','B2C_LARGE',
            'EXPORT','SEZ','DEBIT_NOTE','CREDIT_NOTE'
        )),
    source_section VARCHAR(50) DEFAULT NULL,

    -- Amendment Tracking
    original_invoice_id UUID REFERENCES sales_invoices(id) ON DELETE SET NULL,
    is_amendment BOOLEAN DEFAULT FALSE,
    amendment_reason TEXT,

    -- Filing Compliance
    filing_status VARCHAR(20) DEFAULT 'NOT_FILED'
        CHECK (filing_status IN ('NOT_FILED', 'READY', 'FILED', 'FAILED')),
    filing_date DATE,
    filing_period CHAR(6),
    return_period VARCHAR(10),

    -- Document Identification
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,

    -- Controlled Book Type
    book_type VARCHAR(2) NOT NULL
        CHECK (book_type IN ('SA','SR','CN','DN')),

    entry_serial_no INTEGER DEFAULT 0,

    -- Party Snapshot
    customer_id UUID REFERENCES customer_master(id),
    customer_name VARCHAR(500),
    customer_gstin CHAR(15),

    place_of_supply VARCHAR(100),
    is_interstate BOOLEAN DEFAULT FALSE,
    reverse_charge BOOLEAN DEFAULT FALSE,

    -- Financial Totals
    total_taxable_value NUMERIC(15, 2) DEFAULT 0,
    total_igst NUMERIC(15, 2) DEFAULT 0,
    total_cgst NUMERIC(15, 2) DEFAULT 0,
    total_sgst NUMERIC(15, 2) DEFAULT 0,
    total_cess NUMERIC(15, 2) DEFAULT 0,
    total_invoice_value NUMERIC(15, 2) DEFAULT 0,
    original_invoice_no VARCHAR(100),
    original_invoice_date DATE,
    original_book_vchr_no VARCHAR(100),
    original_book_vchr_date DATE,
    original_net_amount NUMERIC(15, 2),
    return_date DATE,
    original_return_period VARCHAR(10),
    original_return_date DATE,
    round_off NUMERIC(8, 2) DEFAULT 0,

    -- Payment Tracking
    payment_status VARCHAR(20) DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID','PARTIAL','PAID','OVERDUE')),
    amount_paid NUMERIC(15,2) DEFAULT 0,

    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- GST Category & Extra Raw Data
    gstr_category VARCHAR(50),
    t_extra_info JSONB DEFAULT '{}',
    platform VARCHAR(50),

    -- Uniqueness Constraint
    CONSTRAINT uq_sales_invoice_unique 
        UNIQUE (tenant_id, workspace_id, book_type, invoice_number, tax_period_id, total_invoice_value)
);


-- ========================================================
-- 2️⃣ SALES_INVOICE_ITEMS
-- ========================================================

CREATE TABLE sales_invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),

    invoice_id UUID NOT NULL 
        REFERENCES sales_invoices(id) ON DELETE CASCADE,

    -- Line Control
    line_number INTEGER NOT NULL,

    hsn_sac_code VARCHAR(10),
    description TEXT,
    quantity NUMERIC(15, 3) DEFAULT 0,
    uom VARCHAR(20),
    unit_rate NUMERIC(15, 4) DEFAULT 0,

    taxable_value NUMERIC(15, 2) NOT NULL,
    gst_rate_percent NUMERIC(5, 2),
    original_taxable_value NUMERIC(15, 2),
    original_igst_amount NUMERIC(15, 2),
    original_cgst_amount NUMERIC(15, 2),
    original_sgst_amount NUMERIC(15, 2),
    original_cess_amount NUMERIC(15, 2),
    original_gst_rate_percent NUMERIC(5, 2),

    igst_amount NUMERIC(15, 2) DEFAULT 0,
    cgst_amount NUMERIC(15, 2) DEFAULT 0,
    sgst_amount NUMERIC(15, 2) DEFAULT 0,
    cess_amount NUMERIC(15, 2) DEFAULT 0,

    total_amount_with_tax NUMERIC(15, 2) DEFAULT 0,

    -- Reverse Charge Per Line
    is_rcm BOOLEAN DEFAULT FALSE,

    -- Extra Raw Data
    t_extra_info JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


-- ========================================================
-- 3️⃣ PURCHASE_VOUCHERS and PURCHASE_INVOICES
-- ========================================================

CREATE TABLE purchase_vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    tax_period_id UUID REFERENCES tax_periods(id),
    import_filing_id UUID REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,

    -- Voucher Classification
    voucher_type VARCHAR(20)
        CHECK (voucher_type IN (
            'PURCHASE','EXPENSE','DEBIT_NOTE','CREDIT_NOTE'
        )),
    source_section VARCHAR(50) DEFAULT NULL,

    parent_voucher_id UUID 
        REFERENCES purchase_vouchers(id) ON DELETE SET NULL,

    filing_status VARCHAR(20) DEFAULT 'NOT_FILED',
    filing_date DATE,
    filing_period CHAR(6),
    return_period VARCHAR(10),

    supplier_id UUID REFERENCES supplier_master(id),
    supplier_name VARCHAR(500),
    supplier_gstin CHAR(15),

    supplier_invoice_no VARCHAR(100) NOT NULL,
    supplier_invoice_date DATE,
    book_vchr_no VARCHAR(100),
    book_vchr_date DATE,
    due_date DATE,

    -- Added 2026-02-21
    place_of_supply VARCHAR(100),
    is_interstate BOOLEAN DEFAULT FALSE,
    is_rcm BOOLEAN DEFAULT FALSE,
    round_off NUMERIC(8, 2) DEFAULT 0,
    book_type VARCHAR(3) 
        CHECK (book_type IN ('PA','EXP','CN','DN')), 
    status VARCHAR(20) DEFAULT 'DRAFT' 
        CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
    remarks TEXT,
    total_qty NUMERIC(15, 3) DEFAULT 0,
    discount NUMERIC(15, 2) DEFAULT 0,

    taxable_total NUMERIC(15, 2) DEFAULT 0,
    net_amount NUMERIC(15, 2) NOT NULL,
    total_cgst_amount NUMERIC(15, 2) DEFAULT 0,
    total_sgst_amount NUMERIC(15, 2) DEFAULT 0,
    total_igst_amount NUMERIC(15, 2) DEFAULT 0,
    total_cess_amount NUMERIC(15, 2) DEFAULT 0,

    -- ITC Tracking
    itc_eligible BOOLEAN DEFAULT TRUE,
    itc_claimed BOOLEAN DEFAULT FALSE,
    itc_claimed_period CHAR(6),

    -- Payment Tracking
    payment_status VARCHAR(20) DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID','PARTIAL','PAID','OVERDUE')),
    amount_paid NUMERIC(15,2) DEFAULT 0,
    is_amendment BOOLEAN DEFAULT FALSE,
    original_supplier_invoice_date DATE,
    original_supplier_invoice_no VARCHAR(100),
    original_book_vchr_no VARCHAR(100),
    original_book_vchr_date DATE,
    original_net_amount NUMERIC(15, 2),
    return_date DATE,
    original_return_period VARCHAR(10),
    original_return_date DATE,

    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    -- GST Category & Extra Raw Data
    gstr_category VARCHAR(50),
    t_extra_info JSONB DEFAULT '{}',
    platform VARCHAR(50),
    is_deleted BOOLEAN DEFAULT FALSE,
    

    CONSTRAINT uq_purchase_voucher_invoice 
    UNIQUE (tenant_id, workspace_id, book_type, tax_period_id, book_vchr_no, net_amount)
);


-- ========================================================
-- 4️⃣ PURCHASE_ITEMS and PURCHASE_INVOICE_ITEMS
-- ========================================================

CREATE TABLE purchase_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),

    purchase_id UUID NOT NULL 
        REFERENCES purchase_vouchers(id) ON DELETE CASCADE,

    account_id UUID,

    hsn_code VARCHAR(10),
    description TEXT,
    quantity NUMERIC(15, 3) DEFAULT 0,
    uom VARCHAR(20),
    unit_rate NUMERIC(15, 4) DEFAULT 0,

    gross_amount NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    taxable_amount NUMERIC(15, 2) DEFAULT 0,
    tax_per NUMERIC(5, 2),

    igst_amount NUMERIC(15, 2) DEFAULT 0,
    cgst_amount NUMERIC(15, 2) DEFAULT 0,
    sgst_amount NUMERIC(15, 2) DEFAULT 0,
    cess_amount NUMERIC(15, 2) DEFAULT 0,

    row_total NUMERIC(15, 2) DEFAULT 0,
    invoice_amount NUMERIC(15, 2) DEFAULT 0,

    -- Reverse Charge
    is_rcm BOOLEAN DEFAULT FALSE,
    original_taxable_amount NUMERIC(15, 2),
    original_igst_amount NUMERIC(15, 2),
    original_cgst_amount NUMERIC(15, 2),
    original_sgst_amount NUMERIC(15, 2),
    original_cess_amount NUMERIC(15, 2),
    original_tax_per NUMERIC(5, 2),

    -- ITC Blocking (Added 2026-02-21)
    itc_eligible BOOLEAN DEFAULT TRUE,
    itc_block_reason TEXT,

    -- Platform
    platform VARCHAR(100) DEFAULT 'Adesk GST',

    -- Extra Raw Data
    t_extra_info JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMIT;

-- ========================================================
-- END OF DOMAIN 12
-- ========================================================



-- ========================================================
-- DOMAIN 14: NORMALIZED GSTR-2B INVOICES
-- Single unified table across all GSTR-2B sections
-- (B2B / B2BA / CDNR / CDNRA / IMPG / IMPGSEZ / ISD / ISDA)
-- ========================================================

CREATE TABLE IF NOT EXISTS normalized_gstr2b_invoices (

    -- ==============================
    -- PRIMARY INFO
    -- ==============================
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),

    workspace_id UUID NOT NULL,
    tenant_id UUID,
    import_filing_id UUID NOT NULL,

    -- Source tracking
    source_section VARCHAR(30) NOT NULL,
    source_table VARCHAR(50),
    source_row_id UUID,
    source_sheet_name VARCHAR(50),
    source_row_number INTEGER,

    -- ==============================
    -- DOCUMENT CLASSIFICATION
    -- ==============================
    document_category VARCHAR(30),
    document_type VARCHAR(30),
    is_amendment BOOLEAN DEFAULT FALSE,
    amended_document_number TEXT,
    amended_document_date DATE,
    is_active BOOLEAN DEFAULT TRUE,

    -- ==============================
    -- PARTY INFORMATION
    -- ==============================
    supplier_gstin VARCHAR(15),
    supplier_name TEXT,
    recipient_gstin VARCHAR(15),
    place_of_supply VARCHAR(100),
    reverse_charge BOOLEAN DEFAULT FALSE,

    -- ==============================
    -- DOCUMENT DETAILS
    -- ==============================
    document_number_raw TEXT,
    document_number_clean TEXT,
    document_date DATE,
    document_value NUMERIC(18,2),
    invoice_type VARCHAR(30),

    -- For import / BOE
    port_code VARCHAR(20),
    boe_number TEXT,
    boe_date DATE,
    icegate_reference_date DATE,

    -- For ISD
    isd_document_number TEXT,
    isd_document_date DATE,
    original_invoice_number TEXT,
    original_invoice_date DATE,

    -- ==============================
    -- TAX VALUES
    -- ==============================
    taxable_value NUMERIC(18,2) DEFAULT 0,
    igst NUMERIC(18,2) DEFAULT 0,
    cgst NUMERIC(18,2) DEFAULT 0,
    sgst NUMERIC(18,2) DEFAULT 0,
    cess NUMERIC(18,2) DEFAULT 0,
    total_tax NUMERIC(18,2),

    -- ==============================
    -- ITC INFORMATION
    -- ==============================
    itc_available BOOLEAN,
    itc_eligibility VARCHAR(50),
    itc_reason TEXT,
    applicable_tax_rate_percent NUMERIC(10,2),

    -- ==============================
    -- GST FILING INFO
    -- ==============================
    return_period VARCHAR(10),
    filing_period VARCHAR(10),
    filing_date DATE,
    source_type VARCHAR(20) DEFAULT 'PORTAL',

    -- ==============================
    -- RECONCILIATION SUPPORT
    -- ==============================
    match_key TEXT,
    match_key_v2 TEXT,
    reconciliation_status VARCHAR(30),
    reconciliation_run_id UUID,

    -- ==============================
    -- E-INVOICE INFO
    -- ==============================
    irn TEXT,
    irn_date DATE,

    -- ==============================
    -- AUDIT & DEBUG
    -- ==============================
    payload_json JSONB,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP,

    -- Foreign Keys
    CONSTRAINT fk_norm_gstr2b_workspace
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_gstr2b_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_gstr2b_import
        FOREIGN KEY (import_filing_id) REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_tenant     ON normalized_gstr2b_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_workspace  ON normalized_gstr2b_invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_import     ON normalized_gstr2b_invoices(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_period     ON normalized_gstr2b_invoices(return_period);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_supplier   ON normalized_gstr2b_invoices(supplier_gstin);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_section    ON normalized_gstr2b_invoices(source_section);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_recon      ON normalized_gstr2b_invoices(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_match_key  ON normalized_gstr2b_invoices(match_key);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_active     ON normalized_gstr2b_invoices(is_active) WHERE is_active = TRUE;

-- Auto-update trigger for updated_at
DROP TRIGGER IF EXISTS update_normalized_gstr2b_invoices_updated_at ON normalized_gstr2b_invoices;
CREATE TRIGGER update_normalized_gstr2b_invoices_updated_at
BEFORE UPDATE ON normalized_gstr2b_invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ========================================================
-- END OF DOMAIN 14
-- ========================================================

-- GSTR-2A Normalization Table
CREATE TABLE IF NOT EXISTS normalized_gstr2a_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    workspace_id UUID NOT NULL,
    tenant_id UUID,
    import_filing_id UUID NOT NULL,
    source_section VARCHAR(30) NOT NULL,
    source_table VARCHAR(50),
    source_row_id UUID,
    source_sheet_name VARCHAR(50),
    source_row_number INTEGER,
    document_category VARCHAR(30),
    document_type VARCHAR(30),
    is_amendment BOOLEAN DEFAULT FALSE,
    amended_document_number TEXT,
    amended_document_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    supplier_gstin VARCHAR(15),
    supplier_name TEXT,
    recipient_gstin VARCHAR(15),
    place_of_supply VARCHAR(100),
    reverse_charge BOOLEAN DEFAULT FALSE,
    document_number_raw TEXT,
    document_number_clean TEXT,
    document_date DATE,
    document_value NUMERIC(18,2),
    invoice_type VARCHAR(30),
    port_code VARCHAR(20),
    boe_number TEXT,
    boe_date DATE,
    icegate_reference_date DATE,
    isd_document_number TEXT,
    isd_document_date DATE,
    original_invoice_number TEXT,
    original_invoice_date DATE,
    taxable_value NUMERIC(18,2) DEFAULT 0,
    igst NUMERIC(18,2) DEFAULT 0,
    cgst NUMERIC(18,2) DEFAULT 0,
    sgst NUMERIC(18,2) DEFAULT 0,
    cess NUMERIC(18,2) DEFAULT 0,
    total_tax NUMERIC(18,2),
    itc_available BOOLEAN,
    itc_eligibility VARCHAR(50),
    itc_reason TEXT,
    applicable_tax_rate_percent NUMERIC(10,2),
    return_period VARCHAR(10),
    filing_period VARCHAR(10),
    filing_date DATE,
    source_type VARCHAR(20) DEFAULT 'PORTAL',
    match_key TEXT,
    match_key_v2 TEXT,
    reconciliation_status VARCHAR(30),
    reconciliation_run_id UUID,
    irn TEXT,
    irn_date DATE,
    payload_json JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP,
    CONSTRAINT fk_norm_gstr2a_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_gstr2a_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_norm_gstr2a_import FOREIGN KEY (import_filing_id) REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_tenant     ON normalized_gstr2a_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_workspace  ON normalized_gstr2a_invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_import     ON normalized_gstr2a_invoices(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_period     ON normalized_gstr2a_invoices(return_period);
CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_supplier   ON normalized_gstr2a_invoices(supplier_gstin);

DROP TRIGGER IF EXISTS update_normalized_gstr2a_invoices_updated_at ON normalized_gstr2a_invoices;
CREATE TRIGGER update_normalized_gstr2a_invoices_updated_at
BEFORE UPDATE ON normalized_gstr2a_invoices
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================================
-- DOMAIN 15: IMPORT LOGS (Task 2)
-- Per-section detailed logging for each import run
-- ========================================================

CREATE TABLE IF NOT EXISTS gstr_import_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_filing_id UUID NOT NULL,

    -- Section being processed
    section VARCHAR(30) NOT NULL,          -- B2B / B2BA / CDNR / CDNRA / IMPG / ISD
    sheet_name VARCHAR(100),               -- Exact Excel sheet name

    -- Counts
    rows_found INTEGER DEFAULT 0,          -- Total rows parsed from sheet
    rows_inserted INTEGER DEFAULT 0,       -- Rows actually written to section table
    rows_skipped INTEGER DEFAULT 0,        -- Skipped (duplicate / invalid)
    rows_normalized INTEGER DEFAULT 0,     -- Rows written to normalized table

    -- Status of this section's processing
    status VARCHAR(20) DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Processing', 'Done', 'Failed')),
    error_message TEXT,

    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,

    CONSTRAINT fk_import_log_filing
        FOREIGN KEY (import_filing_id) REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_logs_filing  ON gstr_import_logs(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_import_logs_section ON gstr_import_logs(section);

-- ========================================================
-- END OF DOMAIN 15
-- ========================================================


-- ========================================================
-- DOMAIN 14 ADDITIONS: Unique constraint + composite index
-- ========================================================

-- Named UNIQUE constraint for idempotent normalization.
-- ON CONFLICT (import_filing_id, source_section, source_row_id) in batchInsert targets this.
ALTER TABLE normalized_gstr2b_invoices
    DROP CONSTRAINT IF EXISTS uq_norm_source,
    ADD CONSTRAINT uq_norm_source
    UNIQUE (import_filing_id, source_section, source_row_id);

ALTER TABLE normalized_gstr2a_invoices
    DROP CONSTRAINT IF EXISTS uq_norm_source_2a,
    ADD CONSTRAINT uq_norm_source_2a
    UNIQUE (import_filing_id, source_section, source_row_id);

-- Business-key UNIQUE index for cross-route deduplication (Used by batchInsert ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_gstr2b_business_key
    ON normalized_gstr2b_invoices (
        workspace_id, 
        source_section, 
        COALESCE(supplier_gstin, ''), 
        COALESCE(document_number_clean, ''), 
        COALESCE(return_period, '')
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_gstr2a_business_key
    ON normalized_gstr2a_invoices (
        workspace_id, 
        source_section, 
        COALESCE(supplier_gstin, ''), 
        COALESCE(document_number_clean, ''), 
        COALESCE(return_period, '')
    );

-- Composite index for workspace listing + match_key lookups
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_ws_matchkey
    ON normalized_gstr2b_invoices(workspace_id, match_key);

CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_ws_matchkey
    ON normalized_gstr2a_invoices(workspace_id, match_key);

-- ========================================================
-- DOMAIN 16: LISTING VIEW (Task 5)
-- v_gstr_listing — optimized read model for UI listing
-- ========================================================

CREATE OR REPLACE VIEW v_gstr_listing AS
SELECT
    n.id,
    n.workspace_id,
    n.tenant_id,
    n.import_filing_id,
    n.source_section,
    n.document_category,
    n.document_type,
    n.is_amendment,
    n.is_active,

    -- Supplier
    n.supplier_gstin,
    n.supplier_name,
    n.recipient_gstin,
    n.place_of_supply,
    n.reverse_charge,

    -- Document
    n.document_number_raw,
    n.document_number_clean,
    n.document_date,
    n.document_value,

    -- Amendments
    n.amended_document_number,
    n.amended_document_date,
    n.original_invoice_number,
    n.original_invoice_date,

    -- Tax
    n.taxable_value,
    n.igst,
    n.cgst,
    n.sgst,
    n.cess,
    COALESCE(n.total_tax, n.igst + n.cgst + n.sgst + n.cess) AS total_tax,

    -- ITC
    n.itc_available,
    n.itc_eligibility,
    CASE 
        WHEN n.applicable_tax_rate_percent = 100 AND n.taxable_value > 0 THEN ROUND((COALESCE(n.total_tax, n.igst + n.cgst + n.sgst + n.cess) / n.taxable_value) * 100)
        ELSE n.applicable_tax_rate_percent 
    END AS applicable_tax_rate_percent,

    -- Period
    n.return_period,
    n.filing_period,
    n.filing_date,

    -- E-Invoice
    n.irn,
    n.irn_date,

    -- Import metadata
    m.original_filename,
    m.upload_timestamp,
    m.import_type,

    n.created_at
      
FROM normalized_gstr2b_invoices n
JOIN gstr_import_master m USING (import_filing_id)
WHERE n.is_active = TRUE
  AND n.deleted_at IS NULL

UNION ALL

SELECT
    n.id,
    n.workspace_id,
    n.tenant_id,
    n.import_filing_id,
    n.source_section,
    n.document_category,
    n.document_type,
    n.is_amendment,
    n.is_active,

    -- Supplier
    n.supplier_gstin,
    n.supplier_name,
    n.recipient_gstin,
    n.place_of_supply,
    n.reverse_charge,

    -- Document
    n.document_number_raw,
    n.document_number_clean,
    n.document_date,
    n.document_value,

    -- Amendments
    n.amended_document_number,
    n.amended_document_date,
    n.original_invoice_number,
    n.original_invoice_date,

    -- Tax
    n.taxable_value,
    n.igst,
    n.cgst,
    n.sgst,
    n.cess,
    COALESCE(n.total_tax, n.igst + n.cgst + n.sgst + n.cess) AS total_tax,

    -- ITC
    n.itc_available,
    n.itc_eligibility,
    CASE 
        WHEN n.applicable_tax_rate_percent = 100 AND n.taxable_value > 0 THEN ROUND((COALESCE(n.total_tax, n.igst + n.cgst + n.sgst + n.cess) / n.taxable_value) * 100)
        ELSE n.applicable_tax_rate_percent 
    END AS applicable_tax_rate_percent,

    -- Period
    n.return_period,
    n.filing_period,
    n.filing_date,

    -- E-Invoice
    n.irn,
    n.irn_date,

    -- Import metadata
    m.original_filename,
    m.upload_timestamp,
    m.import_type,

    n.created_at
      
FROM normalized_gstr2a_invoices n
JOIN gstr_import_master m USING (import_filing_id)
WHERE n.is_active = TRUE
  AND n.deleted_at IS NULL;

-- ========================================================
-- END OF DOMAIN 16
-- ========================================================

-- Task 4: Composite listing index for fast frontend queries
-- (workspace + period + section + date — covers the main listing sort/filter pattern)
CREATE INDEX IF NOT EXISTS idx_norm_gstr2b_listing
    ON normalized_gstr2b_invoices(workspace_id, return_period, source_section, document_date DESC)
    WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_norm_gstr2a_listing
    ON normalized_gstr2a_invoices(workspace_id, return_period, source_section, document_date DESC)
    WHERE is_active = TRUE AND deleted_at IS NULL;

-- ========================================================
-- DOMAIN 17: RECONCILIATION
-- ========================================================

CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    gstin_id UUID NOT NULL,
    period_id UUID REFERENCES tax_periods(id),
    run_type VARCHAR(50) NOT NULL,
    run_mode VARCHAR(50) NOT NULL,
    rule_set_version VARCHAR(20),
    rule_set_hash VARCHAR(100),
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    total_invoices INTEGER DEFAULT 0,
    matched_count INTEGER DEFAULT 0,
    mismatched_count INTEGER DEFAULT 0,
    missing_count INTEGER DEFAULT 0,
    result_summary JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    recon_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    purchase_invoice_id UUID REFERENCES purchase_vouchers(id),
    gstr2b_invoice_id UUID REFERENCES normalized_gstr2b_invoices(id),
    gstr2a_invoice_id UUID REFERENCES normalized_gstr2a_invoices(id),
    gstr2a_source_id UUID REFERENCES normalized_gstr2a_invoices(id),
    
    match_status VARCHAR(50) NOT NULL,
    match_score DECIMAL(5,2),
    match_confidence VARCHAR(20),
    
    books_value DECIMAL(15,2),
    portal_value DECIMAL(15,2),
    variance_amount DECIMAL(15,2),
    
    itc_decision VARCHAR(50),
    decision_reason TEXT,
    
    action_required VARCHAR(50),
    action_priority VARCHAR(20),
    action_status VARCHAR(50),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Separate results table for 2A vs Book isolation
CREATE TABLE IF NOT EXISTS reconciliation_results_2a (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    recon_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    purchase_invoice_id UUID REFERENCES purchase_vouchers(id),
    gstr2a_invoice_id UUID REFERENCES normalized_gstr2a_invoices(id),
    gstr2a_source_id UUID REFERENCES normalized_gstr2a_invoices(id),
    gstr2b_invoice_id UUID REFERENCES normalized_gstr2b_invoices(id),
    
    match_status VARCHAR(50) NOT NULL,
    match_score DECIMAL(5,2),
    match_confidence VARCHAR(20),
    
    books_value DECIMAL(15,2),
    portal_value DECIMAL(15,2),
    variance_amount DECIMAL(15,2),
    
    itc_decision VARCHAR(50),
    decision_reason TEXT,
    
    action_required VARCHAR(50),
    action_priority VARCHAR(20),
    action_status VARCHAR(50),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    matched_by VARCHAR(20) DEFAULT 'RULE',
    ai_confidence_score DECIMAL(5,2),
    ai_match_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_2a_purchase_inv 
ON reconciliation_results_2a (workspace_id, purchase_invoice_id) 
WHERE purchase_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_2a_gstr2a_inv 
ON reconciliation_results_2a (workspace_id, gstr2a_invoice_id) 
WHERE gstr2a_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reconciliation_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    gstr_data_id UUID,
    gstr_type VARCHAR(20),
    book_data_type VARCHAR(20),
    book_data_id UUID,
    book_line_item_id UUID,
    recon_status VARCHAR(50),
    status VARCHAR(20) DEFAULT 'Active',
    added_by UUID,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extra_info JSONB
);


CREATE TABLE IF NOT EXISTS reconciliation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_result_id UUID NOT NULL REFERENCES reconciliation_results(id) ON DELETE CASCADE,
    action_type VARCHAR(50),
    decision VARCHAR(50),
    decision_reason TEXT,
    notes TEXT,
    performed_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- AI Reconciliation columns (idempotent migration)
ALTER TABLE reconciliation_results
  ADD COLUMN IF NOT EXISTS matched_by VARCHAR(20) DEFAULT 'RULE',
  ADD COLUMN IF NOT EXISTS ai_confidence_score DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS ai_match_reason TEXT;

-- Prevent duplicates by ensuring purchase_invoice_id and gstr2b_invoice_id are unique per workspace
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_purchase_inv 
ON reconciliation_results (workspace_id, purchase_invoice_id) 
WHERE purchase_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_gstr2b_inv 
ON reconciliation_results (workspace_id, gstr2b_invoice_id) 
WHERE gstr2b_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_gstr2a_inv 
ON reconciliation_results (workspace_id, gstr2a_invoice_id) 
WHERE gstr2a_invoice_id IS NOT NULL;
-- Migration: Add GSTR-2A raw tables
-- Mirroring GSTR-2B structure for consistency

-- GSTR-2A B2B
CREATE TABLE IF NOT EXISTS gstr_2a_b2b_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    invoice_number_raw VARCHAR(100),
    invoice_number VARCHAR(50) NOT NULL,
    invoice_type VARCHAR(20),
    invoice_date DATE NOT NULL,
    return_period VARCHAR(255),
    invoice_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    source VARCHAR(50),
    irn VARCHAR(100),
    irn_date DATE,
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_gstr_2a_b2b_invoice UNIQUE (tenant_id, invoice_number, return_period)
);

CREATE INDEX IF NOT EXISTS idx_gstr_2a_b2b_import_filing_id ON gstr_2a_b2b_invoices(import_filing_id);
CREATE INDEX IF NOT EXISTS idx_gstr_2a_b2b_tenant_id ON gstr_2a_b2b_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gstr_2a_b2b_workspace_id ON gstr_2a_b2b_invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gstr_2a_b2b_gstin ON gstr_2a_b2b_invoices(gstin_supplier);

-- GSTR-2A B2BA (Amendments)
CREATE TABLE IF NOT EXISTS gstr_2a_b2ba_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    original_invoice_number VARCHAR(50) NOT NULL,
    original_invoice_date DATE NOT NULL,
    revised_invoice_number VARCHAR(50) NOT NULL,
    revised_invoice_date DATE NOT NULL,
    invoice_type VARCHAR(20),
    return_period VARCHAR(255),
    invoice_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    is_amended BOOLEAN DEFAULT TRUE,
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, original_invoice_number, revised_invoice_number, return_period)
);

-- GSTR-2A CDNR
CREATE TABLE IF NOT EXISTS gstr_2a_cdnr (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    note_type VARCHAR(255),
    note_number VARCHAR(50) NOT NULL,
    note_date DATE NOT NULL,
    original_invoice_number VARCHAR(50),
    original_invoice_date DATE,
    return_period VARCHAR(255),
    note_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, note_number, return_period)
);

-- GSTR-2A CDNRA
CREATE TABLE IF NOT EXISTS gstr_2a_cdnra (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    gstin_supplier VARCHAR(15) NOT NULL,
    trade_name VARCHAR(255),
    original_note_number VARCHAR(50) NOT NULL,
    original_note_date DATE NOT NULL,
    revised_note_number VARCHAR(50) NOT NULL,
    revised_note_date DATE NOT NULL,
    note_type VARCHAR(255),
    original_invoice_number VARCHAR(50),
    original_invoice_date DATE,
    return_period VARCHAR(255),
    note_value NUMERIC(15, 2),
    place_of_supply VARCHAR(100),
    reverse_charge VARCHAR(5) DEFAULT 'No',
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    supplier_filing_period VARCHAR(255),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    is_amended BOOLEAN DEFAULT TRUE,
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, original_note_number, revised_note_number, return_period)
);

-- GSTR-2A IMPG
CREATE TABLE IF NOT EXISTS gstr_2a_impg (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    port_code VARCHAR(255),
    boe_number VARCHAR(50) NOT NULL,
    boe_date DATE NOT NULL,
    return_period VARCHAR(255),
    icegate_ref_date DATE,
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(255),
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, boe_number, port_code, return_period)
);

-- GSTR-2A ISD
CREATE TABLE IF NOT EXISTS gstr_2a_isd (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL REFERENCES gstr_import_master(import_filing_id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    gstin_isd VARCHAR(15) NOT NULL,
    isd_name VARCHAR(255),
    document_type VARCHAR(20),
    document_number VARCHAR(50) NOT NULL,
    document_date DATE NOT NULL,
    return_period VARCHAR(255),
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    central_tax NUMERIC(15, 2) DEFAULT 0,
    state_ut_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    is_amended BOOLEAN DEFAULT FALSE,
    original_document_number VARCHAR(50),
    original_document_date DATE,
    reconciliation_status VARCHAR(50) DEFAULT 'pending' CHECK (reconciliation_status IN ('pending', 'claimed', 'wrong_entry_portal', 'not_to_be_claimed', 'not_eligible_for_claim')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, gstin_isd, document_number, return_period)
);

-- Apply triggers for updated_at
DO $$ 
DECLARE 
    tbl RECORD;
BEGIN
    FOR tbl IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name LIKE 'gstr_2a_%' 
        AND table_schema = 'public'
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%s_updated_at ON %I;
            CREATE TRIGGER update_%s_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', tbl.table_name, tbl.table_name, tbl.table_name, tbl.table_name);
    END LOOP;
END $$;

-- ============================================
-- DOMAIN 18: ITC & RCM MANAGEMENT
-- ============================================

CREATE TABLE IF NOT EXISTS itc_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_vouchers(id) ON DELETE CASCADE,
    period_id UUID REFERENCES tax_periods(id),
    itc_status VARCHAR(50) NOT NULL, -- ELIGIBLE, INELIGIBLE, BLOCKED, REVERSED
    decision_date DATE DEFAULT CURRENT_DATE,
    decision_by UUID REFERENCES users(id),
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS itc_reversal_register (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL,
    period_id UUID REFERENCES tax_periods(id),
    purchase_invoice_id UUID REFERENCES purchase_vouchers(id) ON DELETE CASCADE,
    reversal_type VARCHAR(50), -- 180_DAY_RULE, BLOCKED, OTHER
    reversal_amount NUMERIC(15, 2) DEFAULT 0,
    cgst_amount NUMERIC(15, 2) DEFAULT 0,
    sgst_amount NUMERIC(15, 2) DEFAULT 0,
    igst_amount NUMERIC(15, 2) DEFAULT 0,
    cess_amount NUMERIC(15, 2) DEFAULT 0,
    is_reclaimable BOOLEAN DEFAULT FALSE,
    reclaim_date DATE,
    reclaim_amount NUMERIC(15, 2),
    payment_proof_document_id UUID REFERENCES documents(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rcm_liability_register (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL,
    period_id UUID REFERENCES tax_periods(id),
    purchase_invoice_id UUID REFERENCES purchase_vouchers(id) ON DELETE CASCADE,
    tax_type VARCHAR(20), -- CGST, SGST, IGST
    tax_amount NUMERIC(15, 2) DEFAULT 0,
    liability_status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, PAID
    cash_payment_date DATE,
    cash_payment_amount NUMERIC(15, 2),
    challan_number VARCHAR(100),
    bank_ref_number VARCHAR(100),
    payment_proof_document_id UUID REFERENCES documents(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DOMAIN 19: REPORTS & CONFIGS
-- ============================================

CREATE TABLE IF NOT EXISTS saved_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    report_name VARCHAR(255) NOT NULL,
    report_config JSONB DEFAULT '{}',
    filters_applied JSONB DEFAULT '{}',
    generation_status VARCHAR(20) DEFAULT 'CREATED',
    last_generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    config_name VARCHAR(255) NOT NULL,
    config_type VARCHAR(50), -- AUTO, MANUAL
    invoice_number_tolerance VARCHAR(20) DEFAULT 'EXACT',
    date_tolerance_days INTEGER DEFAULT 0,
    amount_tolerance_percentage NUMERIC(5, 2) DEFAULT 1.00,
    tax_tolerance_percentage NUMERIC(5, 2) DEFAULT 0.00,
    auto_match_threshold NUMERIC(5, 2) DEFAULT 95.00,
    require_manual_review BOOLEAN DEFAULT FALSE,
    exclude_rcm BOOLEAN DEFAULT FALSE,
    exclude_blocked_itc BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    rule_set_version VARCHAR(20) DEFAULT '1.0.0',
    rule_set_hash VARCHAR(100),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DOMAIN 20: 2A VS 2B RECONCILIATION
-- ============================================

CREATE TABLE IF NOT EXISTS reconciliation_status_2a_vs_2b (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    gstr2a_invoice_id uuid,
    gstr2b_invoice_id uuid,
    recon_status character varying(50) DEFAULT 'pending',
    status character varying(20) DEFAULT 'Active',
    added_by uuid,
    added_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by uuid,
    updated_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    extra_info jsonb,
    CONSTRAINT reconciliation_status_2a_vs_2b_pkey PRIMARY KEY (id),
    CONSTRAINT fk_2a_vs_2b_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_2a_vs_2b_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_status_2a_vs_2b_gstr2a ON reconciliation_status_2a_vs_2b (workspace_id, gstr2a_invoice_id) WHERE gstr2a_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_status_2a_vs_2b_gstr2b ON reconciliation_status_2a_vs_2b (workspace_id, gstr2b_invoice_id) WHERE gstr2b_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recon_status_2a_vs_2b_ws ON reconciliation_status_2a_vs_2b (workspace_id);
CREATE INDEX IF NOT EXISTS idx_recon_status_2a_vs_2b_status ON reconciliation_status_2a_vs_2b (recon_status);
-- Create reconciliation_status_gst2a_vs_book table
CREATE TABLE IF NOT EXISTS reconciliation_status_gst2a_vs_book (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    gstr_data_id UUID, -- This will be normalized_gstr2a_invoices.id
    gstr_type VARCHAR(20) DEFAULT 'gstr2a',
    book_data_type VARCHAR(20) DEFAULT 'purchase_voucher',
    book_data_id UUID, -- This will be purchase_vouchers.id
    book_line_item_id UUID,
    recon_status VARCHAR(50) DEFAULT 'pending',
    status VARCHAR(20) DEFAULT 'Active',
    added_by UUID,
    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extra_info JSONB,
    
    -- Constraints and Indexes
    CONSTRAINT chk_recon_status_2a CHECK (recon_status IN ('pending', 'matched', 'mismatched', 'not_in_books', 'not_in_portal', 'excluded')),
    CONSTRAINT fk_gst2a_vs_book_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    CONSTRAINT fk_gst2a_vs_book_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Unique index to prevent duplicate status records for the same invoice
-- This ensures each book invoice or GSTR-2A invoice has only one status in this context
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_status_2a_book ON reconciliation_status_gst2a_vs_book (workspace_id, book_data_id) WHERE book_data_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_status_2a_gstr ON reconciliation_status_gst2a_vs_book (workspace_id, gstr_data_id) WHERE gstr_data_id IS NOT NULL;

-- Standard indexes for performance
CREATE INDEX IF NOT EXISTS idx_recon_status_2a_ws ON reconciliation_status_gst2a_vs_book (workspace_id);
CREATE INDEX IF NOT EXISTS idx_recon_status_2a_recon ON reconciliation_status_gst2a_vs_book (recon_status);

-- ============================================================
-- workspace_api_keys table
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Key Values (stored as generated tokens — treat as sensitive)
    production_key  TEXT NOT NULL UNIQUE,           -- Used for live/real data pushes
    sandbox_key     TEXT NOT NULL UNIQUE,           -- Used for testing/demo

    -- State
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
    mode            VARCHAR(20) NOT NULL DEFAULT 'live'
                        CHECK (mode IN ('live', 'demo')),

    -- Integration Metadata
    third_party_name VARCHAR(100),
    extrainfo       JSONB,

    -- Audit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Only one API key record per workspace
    CONSTRAINT uq_workspace_api_key UNIQUE (workspace_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace    ON workspace_api_keys (workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant       ON workspace_api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status       ON workspace_api_keys (status);
CREATE INDEX IF NOT EXISTS idx_api_keys_prod_key     ON workspace_api_keys (production_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_sand_key     ON workspace_api_keys (sandbox_key);


-- =========================================================================
-- SECTION: TIG INBOUND LOG (Adesk Connector Request/Response Audit Log)
-- =========================================================================

CREATE TABLE IF NOT EXISTS tig_inbound_outbound_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(255),
    request_type    VARCHAR(255),
    user_id         VARCHAR(255),
    tenant_id       VARCHAR(255),
    org_id          VARCHAR(255),
    access_key      VARCHAR(255),       -- api_key (truncated for safety)
    platform        VARCHAR(255),       -- platform name (Tally, Adesk, Zoho, etc.)
    t_params        JSONB,              -- request parameters/body sent to connector
    t_resp_headers  JSONB,              -- response headers received from connector
    t_resp_body     JSONB,              -- response body received from connector
    ip_address      VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    user_agent      VARCHAR(255),
    status          VARCHAR(255),       -- success | error | pending
    extrainfo       JSONB
);

-- Indexes for fast filtering in Adminer/queries
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_org       ON tig_inbound_outbound_log (org_id);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_tenant    ON tig_inbound_outbound_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_type      ON tig_inbound_outbound_log (type);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_status    ON tig_inbound_outbound_log (status);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_created   ON tig_inbound_outbound_log (created_at DESC);

COMMENT ON TABLE tig_inbound_outbound_log IS 'Audit log for all inbound and outbound API connector requests and responses (Adesk, Tally, Zoho, etc.)';

-- ============================================================
-- deleted_invoices: Audit log of deleted book data / gst data records
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(50) NOT NULL CHECK (type IN ('book data', 'gst data')),
    subtype         VARCHAR(100),               -- purchase, sales, credit note, debit note, expense, etc.
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    main_data       JSONB,                      -- snapshot of the parent voucher/invoice row
    line_items      JSONB,                      -- snapshot of the deleted line item(s)
    ref_table_info JSONB,
    vchr_no         VARCHAR(100),
    vchr_date       DATE,
    inv_no          VARCHAR(100),
    inv_date        DATE,
    ip_address      VARCHAR(45),               -- IPv4 or IPv6 of the request
    remark          TEXT,                       -- optional deletion reason entered by user
    deleted_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    t_extra_info    JSONB                       -- deleted_by user info (id, name, email)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_tenant       ON deleted_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_workspace    ON deleted_invoices (workspace_id);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_type_subtype ON deleted_invoices (type, subtype);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_deleted_at   ON deleted_invoices (deleted_at DESC);

COMMENT ON TABLE deleted_invoices IS 'Audit log of deleted invoices from book data or gst data. Preserves full snapshot for recovery and compliance.';


-- ============================================================
-- PERFORMANCE INDEXES (Migration 005)
-- Added 2026-06-06 — covers all hot query paths.
-- All use IF NOT EXISTS so this is safe on re-init.
-- ============================================================

-- purchase_vouchers
CREATE INDEX IF NOT EXISTS idx_pv_workspace_period     ON purchase_vouchers (workspace_id, tax_period_id);
CREATE INDEX IF NOT EXISTS idx_pv_supplier_gstin        ON purchase_vouchers (workspace_id, supplier_gstin);
CREATE INDEX IF NOT EXISTS idx_pv_supplier_invoice_no  ON purchase_vouchers (workspace_id, supplier_invoice_no);
CREATE INDEX IF NOT EXISTS idx_pv_is_deleted           ON purchase_vouchers (workspace_id, is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_pv_book_type            ON purchase_vouchers (workspace_id, book_type);
CREATE INDEX IF NOT EXISTS idx_pv_invoice_date         ON purchase_vouchers (workspace_id, supplier_invoice_date DESC);

-- purchase_items
CREATE INDEX IF NOT EXISTS idx_pi_purchase_id          ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_pi_hsn_code             ON purchase_items (hsn_code);

-- sales_invoices
CREATE INDEX IF NOT EXISTS idx_si_workspace_period     ON sales_invoices (workspace_id, tax_period_id);
CREATE INDEX IF NOT EXISTS idx_si_customer_gstin       ON sales_invoices (workspace_id, customer_gstin);
CREATE INDEX IF NOT EXISTS idx_si_invoice_date         ON sales_invoices (workspace_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_si_book_type            ON sales_invoices (workspace_id, book_type);

-- reconciliation_runs
CREATE INDEX IF NOT EXISTS idx_recon_runs_workspace_status ON reconciliation_runs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recon_runs_period           ON reconciliation_runs (workspace_id, period_id);

-- reconciliation_results
CREATE INDEX IF NOT EXISTS idx_recon_results_run_id    ON reconciliation_results (recon_run_id);
CREATE INDEX IF NOT EXISTS idx_recon_results_ws_status ON reconciliation_results (workspace_id, match_status);
CREATE INDEX IF NOT EXISTS idx_recon_results_itc       ON reconciliation_results (workspace_id, itc_decision);

-- reconciliation_status
CREATE INDEX IF NOT EXISTS idx_recon_status_book_data  ON reconciliation_status (workspace_id, book_data_id) WHERE book_data_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recon_status_gstr_data  ON reconciliation_status (workspace_id, gstr_data_id) WHERE gstr_data_id IS NOT NULL;

-- tig_inbound_outbound_log
CREATE INDEX IF NOT EXISTS idx_tig_log_org_created     ON tig_inbound_outbound_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tig_log_platform        ON tig_inbound_outbound_log (platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tig_log_request_type    ON tig_inbound_outbound_log (request_type, created_at DESC);

-- supplier_master & customer_master
CREATE INDEX IF NOT EXISTS idx_supplier_master_gstin   ON supplier_master (workspace_id, gstin);
CREATE INDEX IF NOT EXISTS idx_supplier_master_name    ON supplier_master (workspace_id, supplier_name);
CREATE INDEX IF NOT EXISTS idx_customer_master_gstin   ON customer_master (workspace_id, gstin);
CREATE INDEX IF NOT EXISTS idx_customer_master_name    ON customer_master (workspace_id, customer_name);

-- gstr_import_master
CREATE INDEX IF NOT EXISTS idx_gstr_import_ws_status   ON gstr_import_master (workspace_id, status, upload_timestamp DESC);


-- ============================================================
-- tig_api_end table (Third-Party Connectors metadata)
-- ============================================================
DO $$ BEGIN
    CREATE TYPE active_inactive_status AS ENUM ('active', 'inactive');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS tig_api_end (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    third_party_code varchar(255) UNIQUE,
    third_party_name varchar(255),
    description text,
    tags text,
    version text,
    
    receive_end_point varchar(255),
    send_end_point varchar(255),
    receive_status active_inactive_status DEFAULT 'active',
    send_status active_inactive_status DEFAULT 'active',
    type varchar(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Insert static connectors
INSERT INTO tig_api_end (third_party_code, third_party_name, description, tags, version, receive_end_point, send_end_point, receive_status, send_status, type)
VALUES 
('tally', 'Tally Prime', 'Direct voucher synchronization and real-world integration with Tally Prime and Tally ERP 9.', 'GSTR-1, GSTR-3B, GSTR-2A, Vouchers', 'v2.1.4', '/connectors/tally/pull-purchase', '/connectors/tally/push', 'active', 'active', 'erp'),
('gsp-provider', 'GSP Provider', 'High-speed sandbox and production API connector to direct-sync returns and filings with the GST Portal.', 'GSTR-1, GSTR-2B, GSTR-3B, OTP Sync', 'v1.0.0', '/connectors/gstn/sync-gstr2b', '/connectors/gstn/otp-request', 'active', 'active', 'gsp'),
('adesk-accounting', 'Adesk Accounting', 'Seamless general ledger sync, auto-reconciliation, and multi-tenant ledger bridging with ADESK ERP.', 'Sales Register, Purchase Vouchers, Auto-Recon', 'v1.2.5', '/connectors/adesk/pull-purchase', '/connectors/adesk/push', 'active', 'active', 'cloud'),
('woocommerce', 'WooCommerce', 'WordPress WooCommerce online storefront tax mapping and automatic sales sync.', 'GSTR-1, GSTR-3B', 'v1.3.2', '/connectors/woocommerce/pull', '/connectors/woocommerce/push', 'active', 'active', 'ecommerce'),
('quickbooks', 'QuickBooks', 'QuickBooks Online cloud accounting customer tax invoice and purchase matching.', 'GSTR-1, GSTR-3B, GSTR-2A', 'v1.8.1', '/connectors/quickbooks/pull', '/connectors/quickbooks/push', 'active', 'active', 'cloud'),
('sap-b1', 'SAP Business One', 'Enterprise SAP B1 database level integration mapping and scheduled sync.', 'All GSTR Types, ERP Bridging', 'v3.2.0', '/connectors/sap/pull', '/connectors/sap/push', 'active', 'active', 'erp'),
('zoho-books', 'Zoho Books', 'Zoho Books cloud accounting transaction mapping and GSTR filing prep.', 'GSTR-1, GSTR-3B', 'v2.0.5', '/connectors/zoho/pull', '/connectors/zoho/push', 'active', 'active', 'cloud')
ON CONFLICT (third_party_code) DO NOTHING;



create table recent_view(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    workspace_id uuid not null,
    user_id uuid not null,
    title varchar(255),
    page_url varchar(255),
    t_extra_info JSONB,
    
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table favourite_master(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    workspace_id uuid not null,
    user_id uuid not null,
    
    title varchar(255),
    page_url varchar(255),
    t_extra_info JSONB,
    
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);