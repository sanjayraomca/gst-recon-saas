-- Total: 52 Tables

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
    workspace_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    gstn VARCHAR(20) NOT NULL,
    legal_name VARCHAR(20),
    pan VARCHAR(20),
    email VARCHAR(20),
    filing_type VARCHAR(10) CHECK (filing_type IN ('m', 'q')),
    state VARCHAR(20),
    city VARCHAR(20),
    address TEXT,
    description TEXT,
    workspace_type VARCHAR(20) NOT NULL DEFAULT 'COMPANY'
        CHECK (workspace_type IN ('COMPANY', 'CA_FIRM', 'CONSULTANT', 'ENTERPRISE')),
    compliance_level VARCHAR(20) DEFAULT 'STANDARD'
        CHECK (compliance_level IN ('STANDARD', 'HIGH', 'AUDIT_READY')),
    industry_type VARCHAR(100),
    turnover_band VARCHAR(50),
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
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspace_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL
        CHECK (role IN ('SUPER_ADMIN', 'WORKSPACE_ADMIN', 'ACCOUNTANT', 
                       'AUDITOR', 'VIEWER', 'GST_PRACTITIONER')),
    permissions JSONB DEFAULT '{
        "can_upload": true,
        "can_reconcile": true,
        "can_override": false,
        "can_export": true,
        "can_invite": false,
        "can_configure": false
    }',
    invitation_status VARCHAR(20) DEFAULT 'ACTIVE'
        CHECK (invitation_status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
    invited_by UUID REFERENCES users(id),
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMPTZ,
    UNIQUE (workspace_id, user_id)
);

-- ============================================
-- DOMAIN 2: GST MASTER DATA (6 tables)
-- ============================================

CREATE TABLE gstin_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin CHAR(15) NOT NULL,
    legal_name VARCHAR(500) NOT NULL,
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
    is_active BOOLEAN DEFAULT TRUE,
    compliance_score NUMERIC(5,2) DEFAULT 100.00,
    last_filing_date DATE,
    next_filing_due_date DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, gstin)
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

CREATE TABLE gst_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rate NUMERIC(4,2) NOT NULL,
    cgst_rate NUMERIC(4,2),
    sgst_rate NUMERIC(4,2),
    igst_rate NUMERIC(4,2),
    description VARCHAR(200),
    hsn_chapter_prefix VARCHAR(10),
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT TRUE,
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
-- NEW: Workspace Period Locks (1 table)
-- ============================================

CREATE TABLE workspace_period_locks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    lock_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
        CHECK (lock_type IN ('MANUAL', 'AUDIT', 'NOTICE', 'FILING', 'SYSTEM')),
    locked_by UUID REFERENCES users(id),
    locked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    unlock_date DATE,
    unlock_reason VARCHAR(200),
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    UNIQUE (workspace_id, period_id)
);

-- ============================================
-- DOMAIN 2.1: SIMPLIFIED STATE MASTER
-- ============================================

CREATE TABLE state_code_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state VARCHAR(100) UNIQUE NOT NULL,
    code CHAR(2) UNIQUE NOT NULL
);

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
-- DOMAIN 3: DATA INGESTION (2 tables)
-- ============================================

CREATE TABLE file_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID REFERENCES gstin_master(id),
    upload_type VARCHAR(30) NOT NULL
        CHECK (upload_type IN ('GSTR1', 'GSTR2B', 'GSTR3B', 'GSTR9', 
                              'ERP_PURCHASE', 'ERP_SALES', 'EINVOICE', 
                              'ICEGATE', 'MANUAL', 'PORTAL_EXPORT')),
    file_name VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    file_hash CHAR(64) NOT NULL,
    mime_type VARCHAR(100),
    storage_path TEXT,
    original_file_name VARCHAR(500),
    upload_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (upload_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL')),
    records_total INTEGER DEFAULT 0,
    records_processed INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    error_details JSONB,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE raw_json_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    upload_id UUID NOT NULL REFERENCES file_uploads(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID REFERENCES gstin_master(id),
    period_id UUID REFERENCES tax_periods(id),
    snapshot_type VARCHAR(30) NOT NULL,
    json_data JSONB NOT NULL,
    json_hash CHAR(64) NOT NULL,
    schema_version VARCHAR(20),
    capture_source VARCHAR(100),
    capture_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_valid BOOLEAN DEFAULT TRUE,
    validation_errors JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DOMAIN 4: TRANSACTION DATA (7 tables)
-- ============================================

CREATE TABLE purchase_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    supplier_id UUID REFERENCES supplier_master(id),
    invoice_number VARCHAR(200) NOT NULL,
    normalized_invoice_number VARCHAR(200) GENERATED ALWAYS AS (
        UPPER(REGEXP_REPLACE(invoice_number, '[^A-Za-z0-9]', '', 'g'))
    ) STORED,
    invoice_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    invoice_type VARCHAR(20) DEFAULT 'TAX'
        CHECK (invoice_type IN ('TAX', 'DEBIT', 'CREDIT', 'REFUND', 'SELF', 'IMPORT')),
    supplier_gstin CHAR(15),
    supplier_name VARCHAR(500),
    supplier_state_code CHAR(2),
    taxable_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_tax_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    invoice_total NUMERIC(15,2) GENERATED ALWAYS AS (
        taxable_value + cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    place_of_supply_code CHAR(2) NOT NULL,
    supply_type VARCHAR(20) DEFAULT 'B2B'
        CHECK (supply_type IN ('B2B', 'B2C', 'EXPORT', 'SEZ', 'DEEMED_EXPORT')),
    reverse_charge BOOLEAN DEFAULT FALSE,
    ecommerce_gstin CHAR(15),
    hsn_sac_code VARCHAR(10),
    hsn_sac_description TEXT,
    item_description TEXT,
    quantity NUMERIC(15,3),
    unit_price NUMERIC(15,2),
    discount_amount NUMERIC(15,2) DEFAULT 0,
    itc_eligibility_status VARCHAR(20) DEFAULT 'ELIGIBLE'
        CHECK (itc_eligibility_status IN ('ELIGIBLE', 'INELIGIBLE', 'RCM', 'BLOCKED', 'PENDING')),
    itc_claimed BOOLEAN DEFAULT FALSE,
    itc_claimed_date DATE,
    itc_claimed_amount NUMERIC(15,2),
    payment_status VARCHAR(20) DEFAULT 'UNPAID'
        CHECK (payment_status IN ('PAID', 'UNPAID', 'PARTIAL')),
    payment_date DATE,
    payment_amount NUMERIC(15,2),
    bill_of_entry_number VARCHAR(100),
    port_code VARCHAR(10),
    import_date DATE,
    customs_duty_amount NUMERIC(15,2),
    source_system VARCHAR(50) NOT NULL,
    source_file_id UUID REFERENCES file_uploads(id),
    raw_data_hash CHAR(64) NOT NULL,
    is_capital_goods BOOLEAN DEFAULT FALSE,
    is_amendment BOOLEAN DEFAULT FALSE,
    original_invoice_id UUID REFERENCES purchase_invoices(id),
    amendment_reason VARCHAR(200),
    revision_number INTEGER DEFAULT 1,
    is_latest_revision BOOLEAN DEFAULT TRUE,
    previous_revision_id UUID REFERENCES purchase_invoices(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    invoice_year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM invoice_date)) STORED,
    CONSTRAINT chk_tax_consistency CHECK (
        (igst_amount > 0 AND cgst_amount = 0 AND sgst_amount = 0) OR
        (igst_amount = 0)
    ),
    CONSTRAINT chk_positive_values CHECK (
        taxable_value >= 0 AND 
        cgst_amount >= 0 AND 
        sgst_amount >= 0 AND 
        igst_amount >= 0 AND 
        cess_amount >= 0
    )
);

CREATE TABLE gstr2b_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    supplier_gstin CHAR(15) NOT NULL,
    supplier_name VARCHAR(500),
    invoice_number VARCHAR(200) NOT NULL,
    normalized_invoice_number VARCHAR(200) GENERATED ALWAYS AS (
        UPPER(REGEXP_REPLACE(invoice_number, '[^A-Za-z0-9]', '', 'g'))
    ) STORED,
    invoice_date DATE NOT NULL,
    taxable_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_tax_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    itc_availability VARCHAR(20) NOT NULL
        CHECK (itc_availability IN ('ELIGIBLE', 'INELIGIBLE', 'RCM', 'BLOCKED', 'EXEMPT', 'NIL')),
    itc_blocked_reason VARCHAR(200),
    itc_blocked_section VARCHAR(50),
    place_of_supply_code CHAR(2) NOT NULL,
    supply_type VARCHAR(20) DEFAULT 'B2B'
        CHECK (supply_type IN ('B2B', 'B2C', 'EXPORT', 'SEZ', 'DEEMED_EXPORT', 'CDNR')),
    is_amendment BOOLEAN DEFAULT FALSE,
    original_invoice_number VARCHAR(200),
    document_type VARCHAR(20) DEFAULT 'INV'
        CHECK (document_type IN ('INV', 'CRN', 'DRN', 'ISDINV')),
    gstr2b_period_id UUID NOT NULL REFERENCES tax_periods(id),
    snapshot_id UUID NOT NULL REFERENCES raw_json_snapshots(id),
    snapshot_captured_at TIMESTAMPTZ NOT NULL,
    match_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (match_status IN ('PENDING', 'MATCHED', 'MISMATCH', 'MISSING', 'DUPLICATE')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    invoice_year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM invoice_date)) STORED,
    CONSTRAINT chk_2b_tax_consistency CHECK (
        (igst_amount > 0 AND cgst_amount = 0 AND sgst_amount = 0) OR
        (igst_amount = 0)
    )
);

CREATE TABLE sales_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    invoice_number VARCHAR(200) NOT NULL,
    normalized_invoice_number VARCHAR(200) GENERATED ALWAYS AS (
        UPPER(REGEXP_REPLACE(invoice_number, '[^A-Za-z0-9]', '', 'g'))
    ) STORED,
    invoice_date DATE NOT NULL,
    invoice_type VARCHAR(20) DEFAULT 'TAX'
        CHECK (invoice_type IN ('TAX', 'DEBIT', 'CREDIT', 'REFUND', 'ADVANCE')),
    recipient_gstin CHAR(15),
    recipient_name VARCHAR(500),
    recipient_state_code CHAR(2),
    place_of_supply_code CHAR(2) NOT NULL,
    taxable_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_tax_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    invoice_total NUMERIC(15,2) GENERATED ALWAYS AS (
        taxable_value + cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    supply_type VARCHAR(20) DEFAULT 'B2B'
        CHECK (supply_type IN ('B2B', 'B2C', 'EXPORT', 'SEZ', 'DEEMED_EXPORT')),
    ecommerce_gstin CHAR(15),
    irn VARCHAR(64),
    irn_ack_no VARCHAR(64),
    irn_ack_date TIMESTAMPTZ,
    irn_qr_code_url TEXT,
    hsn_sac_code VARCHAR(10),
    hsn_sac_description TEXT,
    gstr1_filed BOOLEAN DEFAULT FALSE,
    gstr1_period_id UUID REFERENCES tax_periods(id),
    gstr1_filing_date DATE,
    gstr1_arn VARCHAR(100),
    is_amendment BOOLEAN DEFAULT FALSE,
    amendment_type VARCHAR(20),
    original_invoice_id UUID REFERENCES sales_invoices(id),
    amendment_reason VARCHAR(200),
    source_system VARCHAR(50) NOT NULL,
    source_file_id UUID REFERENCES file_uploads(id),
    raw_data_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    invoice_year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM invoice_date)) STORED
);

CREATE TABLE einvoice_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    sales_invoice_id UUID REFERENCES sales_invoices(id),
    irn VARCHAR(64) UNIQUE NOT NULL,
    ack_no VARCHAR(64),
    ack_date TIMESTAMPTZ NOT NULL,
    irn_status VARCHAR(20) DEFAULT 'ACTIVE'
        CHECK (irn_status IN ('ACTIVE', 'CANCELLED', 'REJECTED')),
    cancel_date TIMESTAMPTZ,
    cancel_reason VARCHAR(200),
    signed_invoice_hash CHAR(64) NOT NULL,
    signed_qr_code TEXT,
    qr_code_url TEXT,
    invoice_data JSONB NOT NULL,
    invoice_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMptz DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- NEW: Import/Export Tables (2 tables)
-- ============================================

CREATE TABLE import_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    bill_of_entry_number VARCHAR(100) NOT NULL,
    boe_date DATE NOT NULL,
    port_code VARCHAR(10),
    customs_house_code VARCHAR(10),
    supplier_name VARCHAR(500),
    supplier_country_code CHAR(2),
    assessable_value NUMERIC(15,2),
    basic_customs_duty NUMERIC(15,2),
    social_welfare_surcharge NUMERIC(15,2),
    integrated_tax NUMERIC(15,2),
    compensation_cess NUMERIC(15,2),
    total_duty_paid NUMERIC(15,2),
    itc_eligible BOOLEAN DEFAULT TRUE,
    itc_claimed BOOLEAN DEFAULT FALSE,
    itc_claimed_date DATE,
    itc_blocked_reason VARCHAR(200),
    is_amended BOOLEAN DEFAULT FALSE,
    original_boe_number VARCHAR(100),
    amendment_reason VARCHAR(200),
    linked_purchase_invoice_id UUID REFERENCES purchase_invoices(id),
    icegate_json_snapshot_id UUID REFERENCES raw_json_snapshots(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, bill_of_entry_number)
);

CREATE TABLE sez_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('SEZ_SUPPLY', 'EOU_SUPPLY', 'DEEMED_EXPORT')),
    sez_unit_gstin CHAR(15),
    sez_unit_name VARCHAR(500),
    sez_approval_number VARCHAR(100),
    shipping_bill_number VARCHAR(100),
    shipping_bill_date DATE,
    port_of_export VARCHAR(100),
    destination_country CHAR(2),
    fob_value NUMERIC(15,2),
    currency_code CHAR(3) DEFAULT 'INR',
    exchange_rate NUMERIC(10,4),
    igst_payable NUMERIC(15,2),
    igst_refund_claimed NUMERIC(15,2),
    lutf_applicable BOOLEAN DEFAULT FALSE,
    lutf_amount NUMERIC(15,2),
    realized BOOLEAN DEFAULT FALSE,
    realization_date DATE,
    realization_amount NUMERIC(15,2),
    linked_sales_invoice_id UUID REFERENCES sales_invoices(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- NEW: Advances Table (1 table)
-- ============================================

CREATE TABLE advance_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    advance_type VARCHAR(20) NOT NULL
        CHECK (advance_type IN ('RECEIVED', 'PAID')),
    party_gstin CHAR(15),
    party_name VARCHAR(500),
    advance_date DATE NOT NULL,
    advance_amount NUMERIC(15,2) NOT NULL,
    cgst_amount NUMERIC(15,2) DEFAULT 0,
    sgst_amount NUMERIC(15,2) DEFAULT 0,
    igst_amount NUMERIC(15,2) DEFAULT 0,
    cess_amount NUMERIC(15,2) DEFAULT 0,
    total_tax_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    fully_adjusted BOOLEAN DEFAULT FALSE,
    adjusted_amount NUMERIC(15,2) DEFAULT 0,
    remaining_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        advance_amount - adjusted_amount
    ) STORED,
    gstr1_reported BOOLEAN DEFAULT FALSE,
    gstr1_table VARCHAR(10),
    gstr1_period_id UUID REFERENCES tax_periods(id),
    adjustment_invoice_ids UUID[],
    last_adjustment_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- NEW: ISD Tables (2 tables)
-- ============================================

CREATE TABLE isd_credit_distribution (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    isd_gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    invoice_id UUID NOT NULL,
    invoice_type VARCHAR(10) DEFAULT 'ISDINV'
        CHECK (invoice_type IN ('ISDINV', 'REGINV')),
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL,
    total_credit_available NUMERIC(15,2) NOT NULL,
    cgst_credit NUMERIC(15,2) NOT NULL,
    sgst_credit NUMERIC(15,2) NOT NULL,
    igst_credit NUMERIC(15,2) NOT NULL,
    cess_credit NUMERIC(15,2) NOT NULL,
    distributed BOOLEAN DEFAULT FALSE,
    distribution_date DATE,
    distribution_method VARCHAR(20) DEFAULT 'TURNOVER'
        CHECK (distribution_method IN ('TURNOVER', 'EQUALLY', 'MANUAL', 'RULES')),
    gstr6_filed BOOLEAN DEFAULT FALSE,
    gstr6_period_id UUID REFERENCES tax_periods(id),
    gstr6_arn VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE isd_unit_distribution (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    isd_distribution_id UUID NOT NULL REFERENCES isd_credit_distribution(id) ON DELETE CASCADE,
    recipient_gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    distribution_percentage NUMERIC(5,2) NOT NULL,
    distribution_basis VARCHAR(200),
    cgst_distributed NUMERIC(15,2) NOT NULL,
    sgst_distributed NUMERIC(15,2) NOT NULL,
    igst_distributed NUMERIC(15,2) NOT NULL,
    cess_distributed NUMERIC(15,2) NOT NULL,
    total_distributed NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_distributed + sgst_distributed + igst_distributed + cess_distributed
    ) STORED,
    utilized BOOLEAN DEFAULT FALSE,
    utilized_in_period_id UUID REFERENCES tax_periods(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DOMAIN 5: RECONCILIATION ENGINE (3 tables)
-- ============================================

CREATE TABLE reconciliation_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    config_name VARCHAR(100) NOT NULL,
    config_type VARCHAR(30) NOT NULL
        CHECK (config_type IN ('PURCHASE_2B', 'SALES_1', 'LIABILITY_3B', 'ANNUAL_9')),
    invoice_number_tolerance VARCHAR(20) DEFAULT 'EXACT'
        CHECK (invoice_number_tolerance IN ('EXACT', 'FUZZY', 'PREFIX')),
    date_tolerance_days INTEGER DEFAULT 0,
    amount_tolerance_percentage NUMERIC(5,2) DEFAULT 1.00,
    tax_tolerance_percentage NUMERIC(5,2) DEFAULT 0.00,
    auto_match_threshold NUMERIC(5,2) DEFAULT 95.00,
    require_manual_review BOOLEAN DEFAULT FALSE,
    exclude_rcm BOOLEAN DEFAULT FALSE,
    exclude_blocked_itc BOOLEAN DEFAULT TRUE,
    rule_set_version VARCHAR(50) NOT NULL,
    rule_set_hash CHAR(64) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, config_name)
);

CREATE TABLE reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    run_type VARCHAR(30) NOT NULL
        CHECK (run_type IN ('PURCHASE_2B', 'SALES_1', 'LIABILITY_3B', 'ANNUAL_9', 'FULL')),
    run_mode VARCHAR(20) NOT NULL DEFAULT 'AUTO'
        CHECK (run_mode IN ('AUTO', 'MANUAL', 'REPROCESS', 'FORCED')),
    config_id UUID REFERENCES reconciliation_configs(id),
    rule_set_version VARCHAR(50) NOT NULL,
    rule_set_hash CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL')),
    total_invoices INTEGER DEFAULT 0,
    matched_count INTEGER DEFAULT 0,
    mismatched_count INTEGER DEFAULT 0,
    missing_count INTEGER DEFAULT 0,
    duplicate_count INTEGER DEFAULT 0,
    matched_value NUMERIC(15,2) DEFAULT 0,
    mismatched_value NUMERIC(15,2) DEFAULT 0,
    missing_value NUMERIC(15,2) DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processing_time_ms INTEGER,
    result_summary JSONB,
    error_details JSONB,
    executed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reconciliation_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recon_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    purchase_invoice_id UUID REFERENCES purchase_invoices(id),
    gstr2b_invoice_id UUID REFERENCES gstr2b_invoices(id),
    sales_invoice_id UUID REFERENCES sales_invoices(id),
    match_status VARCHAR(20) NOT NULL
        CHECK (match_status IN ('EXACT', 'PARTIAL', 'MISMATCH', 'MISSING', 'DUPLICATE', 'EXCLUDED')),
    match_score NUMERIC(5,2) CHECK (match_score >= 0 AND match_score <= 100),
    match_confidence VARCHAR(20) DEFAULT 'MEDIUM'
        CHECK (match_confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    invoice_number_score NUMERIC(5,2),
    date_score NUMERIC(5,2),
    amount_score NUMERIC(5,2),
    tax_score NUMERIC(5,2),
    gstin_score NUMERIC(5,2),
    mismatch_fields TEXT[],
    books_value NUMERIC(15,2),
    portal_value NUMERIC(15,2),
    variance_amount NUMERIC(15,2),
    variance_percentage NUMERIC(5,2),
    itc_decision VARCHAR(20) NOT NULL
        CHECK (itc_decision IN ('ELIGIBLE', 'INELIGIBLE', 'DEFERRED', 'REVERSED', 'PENDING', 'HOLD')),
    decision_reason VARCHAR(200),
    decision_confidence VARCHAR(20) DEFAULT 'MEDIUM',
    applicable_section VARCHAR(50),
    rule_applied VARCHAR(100),
    rule_version VARCHAR(50),
    action_required VARCHAR(50),
    action_priority VARCHAR(20) DEFAULT 'MEDIUM'
        CHECK (action_priority IN ('HIGH', 'MEDIUM', 'LOW')),
    assigned_to UUID REFERENCES users(id),
    action_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (action_status IN ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED')),
    first_seen_at TIMESTAMptz DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    next_review_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_invoice_reference CHECK (
        (purchase_invoice_id IS NOT NULL) OR 
        (gstr2b_invoice_id IS NOT NULL) OR 
        (sales_invoice_id IS NOT NULL)
    )
);

-- ============================================
-- DOMAIN 6: ITC MANAGEMENT (3 tables)
-- ============================================

CREATE TABLE itc_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    decision VARCHAR(20) NOT NULL
        CHECK (decision IN ('CLAIM', 'DEFER', 'REVERSE', 'FORFEIT', 'HOLD')),
    decision_type VARCHAR(30) NOT NULL
        CHECK (decision_type IN ('AUTO', 'MANUAL', 'OVERRIDE', 'SYSTEM')),
    itc_amount NUMERIC(15,2) NOT NULL,
    cgst_amount NUMERIC(15,2) NOT NULL,
    sgst_amount NUMERIC(15,2) NOT NULL,
    igst_amount NUMERIC(15,2) NOT NULL,
    cess_amount NUMERIC(15,2) NOT NULL,
    gst_section VARCHAR(50) NOT NULL,
    circular_reference VARCHAR(100),
    legal_basis TEXT,
    decision_reason VARCHAR(200) NOT NULL,
    reason_code VARCHAR(50),
    effective_from DATE NOT NULL,
    effective_to DATE,
    decision_date DATE NOT NULL,
    reversal_amount NUMERIC(15,2) DEFAULT 0,
    interest_applicable BOOLEAN DEFAULT FALSE,
    interest_amount NUMERIC(15,2) DEFAULT 0,
    interest_calculated_date DATE,
    decided_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    is_overridden BOOLEAN DEFAULT FALSE,
    override_reason VARCHAR(200)
);

CREATE TABLE itc_reversal_register (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    reversal_type VARCHAR(30) NOT NULL
        CHECK (reversal_type IN ('180_DAY_RULE', 'BLOCKED_CATEGORY', 'AMENDMENT', 
                                'VENDOR_DEFAULT', 'SECTION_17_5', 'OTHER')),
    reversal_date DATE NOT NULL,
    reversal_amount NUMERIC(15,2) NOT NULL,
    interest_applicable BOOLEAN DEFAULT TRUE,
    interest_rate NUMERIC(5,2) DEFAULT 18.00,
    interest_amount NUMERIC(15,2) DEFAULT 0,
    interest_calculated_date DATE,
    is_reclaimable BOOLEAN DEFAULT FALSE,
    reclaim_condition VARCHAR(200),
    reclaimed BOOLEAN DEFAULT FALSE,
    reclaim_date DATE,
    reclaim_amount NUMERIC(15,2),
    payment_made BOOLEAN DEFAULT FALSE,
    payment_date DATE,
    payment_amount NUMERIC(15,2),
    payment_proof_document_id UUID,
    reversed_by UUID REFERENCES users(id),
    reversal_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    gstr3b_table VARCHAR(10),
    gstr3b_row_number INTEGER
);

CREATE TABLE rcm_liability_register (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    tax_type VARCHAR(10) NOT NULL
        CHECK (tax_type IN ('CGST', 'SGST', 'IGST', 'CESS')),
    tax_amount NUMERIC(15,2) NOT NULL,
    paid_in_cash_ledger BOOLEAN DEFAULT FALSE,
    cash_payment_date DATE,
    cash_payment_amount NUMERIC(15,2),
    cash_ledger_challan_number VARCHAR(100),
    itc_claimable BOOLEAN DEFAULT TRUE,
    itc_claimed BOOLEAN DEFAULT FALSE,
    itc_claimed_date DATE,
    itc_claimed_amount NUMERIC(15,2),
    self_invoice_number VARCHAR(100),
    self_invoice_date DATE,
    liability_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (liability_status IN ('PENDING', 'PAID', 'ITC_CLAIMED', 'LAPSED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    gstr3b_table VARCHAR(10),
    gstr3b_reported BOOLEAN DEFAULT FALSE
);

-- ============================================
-- DOMAIN 7: RETURNS & LEDGER MANAGEMENT (2 tables)
-- ============================================

CREATE TABLE gstr3b_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    return_snapshot_id UUID NOT NULL REFERENCES raw_json_snapshots(id),
    table_number VARCHAR(10) NOT NULL,
    row_identifier VARCHAR(100),
    description TEXT,
    taxable_value NUMERIC(15,2),
    integrated_tax NUMERIC(15,2),
    central_tax NUMERIC(15,2),
    state_tax NUMERIC(15,2),
    cess NUMERIC(15,2),
    tax_type VARCHAR(20),
    supply_type VARCHAR(50),
    itc_type VARCHAR(20),
    reconciled BOOLEAN DEFAULT FALSE,
    variance_amount NUMERIC(15,2),
    variance_percentage NUMERIC(5,2),
    reconciliation_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gst_ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    period_id UUID NOT NULL REFERENCES tax_periods(id),
    ledger_type VARCHAR(20) NOT NULL
        CHECK (ledger_type IN ('CASH', 'CREDIT', 'LIABILITY')),
    transaction_type VARCHAR(50) NOT NULL
        CHECK (transaction_type IN ('PAYMENT', 'UTILIZATION', 'REFUND', 'REVERSAL', 
                                  'TRANSFER_IN', 'TRANSFER_OUT', 'INTEREST', 'PENALTY')),
    transaction_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    challan_number VARCHAR(100),
    bank_ref_number VARCHAR(100),
    cgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(15,2) GENERATED ALWAYS AS (
        cgst_amount + sgst_amount + igst_amount + cess_amount
    ) STORED,
    opening_balance NUMERIC(15,2),
    closing_balance NUMERIC(15,2),
    reference_type VARCHAR(50),
    reference_id UUID,
    reference_document_number VARCHAR(100),
    is_reconciled BOOLEAN DEFAULT FALSE,
    reconciliation_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (reconciliation_status IN ('PENDING', 'MATCHED', 'MISMATCH', 'UNMATCHED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    source_system VARCHAR(50)
);

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

CREATE TABLE gst_notices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    notice_number VARCHAR(100) NOT NULL,
    notice_type VARCHAR(50) NOT NULL
        CHECK (notice_type IN ('DRC-01', 'DRC-01A', 'SCN', 'ASMT-10', 'AUDIT', 
                              'INTIMATION', 'SHOW_CAUSE', 'DEMAND', 'OTHER')),
    notice_date DATE NOT NULL,
    received_date DATE NOT NULL,
    due_date DATE,
    issuing_authority VARCHAR(200),
    jurisdiction VARCHAR(100),
    demand_amount NUMERIC(15,2) DEFAULT 0,
    interest_amount NUMERIC(15,2) DEFAULT 0,
    penalty_amount NUMERIC(15,2) DEFAULT 0,
    total_payable NUMERIC(15,2) GENERATED ALWAYS AS (
        demand_amount + interest_amount + penalty_amount
    ) STORED,
    reason_code VARCHAR(50),
    reason_description TEXT,
    sections_applicable VARCHAR(500),
    periods_covered VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'REPLIED', 'UNDER_REVIEW', 'RESOLVED', 
                         'APPEALED', 'CLOSED', 'WITHDRAWN')),
    response_due_date DATE,
    response_submitted_date DATE,
    response_arn VARCHAR(100),
    notice_document_id UUID,
    response_document_id UUID,
    supporting_documents JSONB,
    linked_recon_run_id UUID REFERENCES reconciliation_runs(id),
    linked_invoice_ids UUID[],
    linked_period_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id),
    UNIQUE (workspace_id, notice_number)
);

CREATE TABLE notice_defense_packs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notice_id UUID NOT NULL REFERENCES gst_notices(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    defense_strategy VARCHAR(50)
        CHECK (defense_strategy IN ('FULL_DENIAL', 'PARTIAL_ACCEPTANCE', 
                                   'TECHNICAL_DEFECT', 'TIME_BARRED', 'OTHER')),
    legal_grounds TEXT,
    case_precedents TEXT,
    draft_reply TEXT,
    explanation_summary TEXT,
    supporting_arguments JSONB,
    evidence_snapshot_ids UUID[],
    recon_snapshot_id UUID,
    document_references JSONB,
    generation_status VARCHAR(20) DEFAULT 'DRAFT'
        CHECK (generation_status IN ('DRAFT', 'REVIEW', 'APPROVED', 'FILED', 'ARCHIVED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ
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

CREATE TABLE vendor_communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    supplier_gstin CHAR(15),
    supplier_id UUID REFERENCES supplier_master(id),
    communication_type VARCHAR(30) NOT NULL
        CHECK (communication_type IN ('EMAIL', 'PHONE', 'LETTER', 'WHATSAPP', 'MEETING', 'SYSTEM')),
    direction VARCHAR(10) NOT NULL
        CHECK (direction IN ('SENT', 'RECEIVED')),
    subject VARCHAR(500),
    body TEXT,
    attachments JSONB,
    related_invoice_ids UUID[],
    related_period_id UUID REFERENCES tax_periods(id),
    issue_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'SENT'
        CHECK (status IN ('DRAFT', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'RESOLVED')),
    requires_follow_up BOOLEAN DEFAULT FALSE,
    follow_up_date DATE,
    follow_up_notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    replied_at TIMESTAMPTZ
);

-- ============================================
-- NEW: Cash Flow Impact (1 table)
-- ============================================

CREATE TABLE cash_flow_impact (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    gstin_id UUID NOT NULL REFERENCES gstin_master(id),
    analysis_date DATE NOT NULL,
    period_id UUID REFERENCES tax_periods(id),
    eligible_itc NUMERIC(15,2) DEFAULT 0,
    deferred_itc NUMERIC(15,2) DEFAULT 0,
    reversed_itc NUMERIC(15,2) DEFAULT 0,
    claimed_itc NUMERIC(15,2) DEFAULT 0,
    rcm_payable NUMERIC(15,2) DEFAULT 0,
    interest_payable NUMERIC(15,2) DEFAULT 0,
    penalty_payable NUMERIC(15,2) DEFAULT 0,
    working_capital_blocked NUMERIC(15,2) DEFAULT 0,
    expected_cash_outflow NUMERIC(15,2) DEFAULT 0,
    next_30_days_outflow NUMERIC(15,2) DEFAULT 0,
    risk_score NUMERIC(5,2) DEFAULT 0,
    risk_level VARCHAR(20) DEFAULT 'LOW'
        CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    recommendations JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    generated_by UUID REFERENCES users(id)
);

-- ============================================
-- NEW: Compliance Scores (1 table)
-- ============================================

CREATE TABLE compliance_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type VARCHAR(20) NOT NULL
        CHECK (entity_type IN ('GSTIN', 'SUPPLIER', 'VENDOR', 'WORKSPACE')),
    entity_id UUID NOT NULL,
    score_date DATE NOT NULL,
    score_period VARCHAR(7),
    
    -- Store base/raw values
    filing_timeliness_raw NUMERIC(5,2),
    data_accuracy_raw NUMERIC(5,2),
    itc_utilization_raw NUMERIC(5,2),
    vendor_compliance_raw NUMERIC(5,2),
    notice_history_raw NUMERIC(5,2),
    
    -- Calculate everything directly from raw values
    overall_score NUMERIC(5,2) GENERATED ALWAYS AS (
        (COALESCE(filing_timeliness_raw, 100) * 0.25 +
         COALESCE(data_accuracy_raw, 100) * 0.25 +
         COALESCE(itc_utilization_raw, 100) * 0.20 +
         COALESCE(vendor_compliance_raw, 100) * 0.20 +
         COALESCE(notice_history_raw, 100) * 0.10)
    ) STORED,
    
    -- Calculate score_band from the same raw values calculation
    score_band VARCHAR(20) GENERATED ALWAYS AS (
        CASE 
            WHEN (COALESCE(filing_timeliness_raw, 100) * 0.25 +
                  COALESCE(data_accuracy_raw, 100) * 0.25 +
                  COALESCE(itc_utilization_raw, 100) * 0.20 +
                  COALESCE(vendor_compliance_raw, 100) * 0.20 +
                  COALESCE(notice_history_raw, 100) * 0.10) >= 80 THEN 'EXCELLENT'
            WHEN (COALESCE(filing_timeliness_raw, 100) * 0.25 +
                  COALESCE(data_accuracy_raw, 100) * 0.25 +
                  COALESCE(itc_utilization_raw, 100) * 0.20 +
                  COALESCE(vendor_compliance_raw, 100) * 0.20 +
                  COALESCE(notice_history_raw, 100) * 0.10) >= 60 THEN 'GOOD'
            WHEN (COALESCE(filing_timeliness_raw, 100) * 0.25 +
                  COALESCE(data_accuracy_raw, 100) * 0.25 +
                  COALESCE(itc_utilization_raw, 100) * 0.20 +
                  COALESCE(vendor_compliance_raw, 100) * 0.20 +
                  COALESCE(notice_history_raw, 100) * 0.10) >= 40 THEN 'FAIR'
            WHEN (COALESCE(filing_timeliness_raw, 100) * 0.25 +
                  COALESCE(data_accuracy_raw, 100) * 0.25 +
                  COALESCE(itc_utilization_raw, 100) * 0.20 +
                  COALESCE(vendor_compliance_raw, 100) * 0.20 +
                  COALESCE(notice_history_raw, 100) * 0.10) >= 20 THEN 'POOR'
            ELSE 'CRITICAL'
        END
    ) STORED,
    
    improvement_areas TEXT[],
    positive_aspects TEXT[],
    industry_average NUMERIC(5,2),
    peer_percentile NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, entity_type, entity_id, score_date)
);

-- ============================================
-- DOMAIN 9: ALERTS & RULES (3 tables)
-- ============================================

CREATE TABLE system_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL
        CHECK (alert_type IN ('VENDOR_NON_FILING', 'ITC_MISMATCH', 'NOTICE_RECEIVED',
                             'FILING_DUE', 'RECONCILIATION_FAILED', 'DATA_DISCREPANCY',
                             'RULE_CHANGE', 'SYSTEM_MAINTENANCE', 'PERFORMANCE_ISSUE')),
    severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
        CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    reference_ids UUID[],
    alert_data JSONB,
    status VARCHAR(20) DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
    action_required BOOLEAN DEFAULT FALSE,
    action_taken VARCHAR(200),
    action_taken_by UUID REFERENCES users(id),
    action_taken_at TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    expiry_at TIMESTAMPTZ,
    delivered_via TEXT[],
    delivery_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gst_rules_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_code VARCHAR(100) UNIQUE NOT NULL,
    rule_name VARCHAR(200) NOT NULL,
    rule_category VARCHAR(50) NOT NULL
        CHECK (rule_category IN ('ELIGIBILITY', 'BLOCKING', 'TIMING', 'DOCUMENTATION',
                                'PAYMENT', 'RCM', 'IMPORT', 'EXPORT', 'COMPOSITION')),
    gst_section VARCHAR(50),
    rule_number VARCHAR(50),
    notification_number VARCHAR(100),
    circular_number VARCHAR(100),
    description TEXT NOT NULL,
    rule_condition JSONB NOT NULL,
    rule_action VARCHAR(200) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    applicable_to VARCHAR(100) DEFAULT 'ALL'
        CHECK (applicable_to IN ('ALL', 'REGULAR', 'COMPOSITION', 'SEZ', 'ISD')),
    severity VARCHAR(20) DEFAULT 'MEDIUM'
        CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
    risk_score NUMERIC(5,2) DEFAULT 50.00,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    is_deprecated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE itc_blocked_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_code VARCHAR(50) UNIQUE NOT NULL,
    category_name VARCHAR(200) NOT NULL,
    gst_section VARCHAR(50) NOT NULL,
    hsn_chapter_prefix VARCHAR(10),
    hsn_range_start VARCHAR(10),
    hsn_range_end VARCHAR(10),
    sac_code_prefix VARCHAR(10),
    sac_range_start VARCHAR(10),
    sac_range_end VARCHAR(10),
    description TEXT,
    exceptions TEXT,
    conditions TEXT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DOMAIN 10: REPORTING (1 table)
-- ============================================

CREATE TABLE saved_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    report_name VARCHAR(200) NOT NULL,
    report_type VARCHAR(50) NOT NULL
        CHECK (report_type IN ('ITC_SUMMARY', 'MISMATCH_DETAIL', 'VENDOR_ANALYSIS',
                              'COMPLIANCE_SCORE', 'RISK_ASSESSMENT', 'CASH_FLOW',
                              'AUDIT_TRAIL', 'CUSTOM')),
    report_config JSONB NOT NULL,
    filters_applied JSONB,
    columns_selected TEXT[],
    is_scheduled BOOLEAN DEFAULT FALSE,
    schedule_frequency VARCHAR(20)
        CHECK (schedule_frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
    schedule_day INTEGER,
    schedule_time TIME,
    recipients JSONB,
    last_generated_at TIMESTAMPTZ,
    last_generated_by UUID REFERENCES users(id),
    generation_status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, report_name)
);

-- ============================================
-- NEW: User Preferences (1 table)
-- ============================================

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    default_dashboard_view VARCHAR(50) DEFAULT 'ITC_SUMMARY',
    visible_widgets TEXT[] DEFAULT '{"itc_summary", "mismatch_alerts", "compliance_score", "upcoming_tasks"}',
    dashboard_layout JSONB DEFAULT '{"columns": 3, "widgets": []}',
    email_notifications BOOLEAN DEFAULT TRUE,
    in_app_notifications BOOLEAN DEFAULT TRUE,
    sms_notifications BOOLEAN DEFAULT FALSE,
    notification_frequency VARCHAR(20) DEFAULT 'REALTIME'
        CHECK (notification_frequency IN ('REALTIME', 'DAILY', 'WEEKLY', 'NONE')),
    date_format VARCHAR(20) DEFAULT 'DD-MM-YYYY',
    number_format VARCHAR(20) DEFAULT 'INDIAN',
    theme VARCHAR(20) DEFAULT 'LIGHT'
        CHECK (theme IN ('LIGHT', 'DARK', 'AUTO')),
    default_gstin_id UUID REFERENCES gstin_master(id),
    default_period_range VARCHAR(20) DEFAULT 'LAST_3_MONTHS',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, workspace_id)
);

-- ============================================
-- NEW: API Usage (1 table)
-- ============================================

CREATE TABLE api_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),
    workspace_id UUID REFERENCES workspaces(id),
    user_id UUID REFERENCES users(id),
    api_endpoint VARCHAR(500) NOT NULL,
    http_method VARCHAR(10) NOT NULL,
    http_status_code INTEGER,
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    processing_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- NEW: Batch Jobs (1 table)
-- ============================================

CREATE TABLE batch_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL
        CHECK (job_type IN ('RECONCILIATION', 'REPORT_GENERATION', 'DATA_IMPORT', 
                           'NOTICE_GENERATION', 'VENDOR_SCORING', 'CLEANUP')),
    job_name VARCHAR(200) NOT NULL,
    job_description TEXT,
    job_parameters JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 
                         'FAILED', 'CANCELLED', 'RETRYING')),
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_for TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_retry_at TIMESTAMPTZ,
    result_data JSONB,
    error_details JSONB,
    progress_percentage NUMERIC(5,2) DEFAULT 0,
    progress_message VARCHAR(500),
    depends_on_job_ids UUID[],
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- CREATE ALL INDEXES AFTER TABLES ARE CREATED
-- ============================================

-- Index for raw_json_snapshots
CREATE INDEX IF NOT EXISTS idx_raw_json_hash ON raw_json_snapshots (json_hash);

-- Indexes for reconciliation_runs
CREATE INDEX IF NOT EXISTS idx_recon_run_status ON reconciliation_runs (status);
CREATE INDEX IF NOT EXISTS idx_recon_run_type ON reconciliation_runs (run_type);
CREATE INDEX IF NOT EXISTS idx_recon_run_period ON reconciliation_runs (period_id, status);

-- Indexes for reconciliation_results
CREATE INDEX IF NOT EXISTS idx_recon_results_status ON reconciliation_results (match_status, itc_decision) WHERE match_status IN ('MISMATCH', 'MISSING');
CREATE INDEX IF NOT EXISTS idx_recon_purchase ON reconciliation_results (purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL;

-- Indexes for audit_trail
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail (created_at DESC);

-- Indexes for documents
CREATE INDEX IF NOT EXISTS idx_document_hash ON documents (file_hash);
CREATE INDEX IF NOT EXISTS idx_document_entity ON documents (linked_entity_type, linked_entity_id);

-- Indexes for system_alerts
CREATE INDEX IF NOT EXISTS idx_alerts_status ON system_alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON system_alerts (severity);

-- Indexes for gst_rules_master
CREATE INDEX IF NOT EXISTS idx_rules_active ON gst_rules_master (is_active, effective_from, effective_to);

-- Indexes for api_usage
CREATE INDEX IF NOT EXISTS idx_api_usage_timestamp ON api_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON api_usage (api_endpoint, http_method);

-- Indexes for batch_jobs
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs (status, priority DESC, scheduled_for);

-- Indexes for purchase_invoices
CREATE INDEX IF NOT EXISTS idx_purchase_workspace_date ON purchase_invoices (workspace_id, invoice_date DESC) WHERE is_latest_revision = TRUE;
CREATE INDEX IF NOT EXISTS idx_purchase_supplier_invoice ON purchase_invoices (supplier_gstin, normalized_invoice_number, invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_rcm ON purchase_invoices (reverse_charge, itc_eligibility_status);
CREATE INDEX IF NOT EXISTS idx_purchase_payment_status ON purchase_invoices (payment_status, invoice_date) WHERE payment_status = 'UNPAID';

-- Indexes for gstr2b_invoices
CREATE INDEX IF NOT EXISTS idx_gstr2b_supplier ON gstr2b_invoices (supplier_gstin, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_gstr2b_itc_status ON gstr2b_invoices (itc_availability, invoice_date);
CREATE INDEX IF NOT EXISTS idx_gstr2b_period ON gstr2b_invoices (gstr2b_period_id, supplier_gstin);

-- Indexes for sales_invoices
CREATE INDEX IF NOT EXISTS idx_sales_recipient ON sales_invoices (recipient_gstin, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_irn ON sales_invoices (irn) WHERE irn IS NOT NULL;

-- Indexes for itc_decisions
CREATE INDEX IF NOT EXISTS idx_itc_decisions_period ON itc_decisions (period_id, decision);

-- Indexes for itc_reversal_register
CREATE INDEX IF NOT EXISTS idx_itc_reversal_invoice ON itc_reversal_register (purchase_invoice_id, reversal_type);

-- Indexes for gst_notices
CREATE INDEX IF NOT EXISTS idx_notices_status ON gst_notices (status, notice_date DESC);
CREATE INDEX IF NOT EXISTS idx_notices_period ON gst_notices USING GIN (linked_period_ids);

-- Indexes for supplier_master
CREATE INDEX IF NOT EXISTS idx_supplier_gstin ON supplier_master (gstin) WHERE gstin IS NOT NULL;

-- Indexes for compliance_scores
CREATE INDEX IF NOT EXISTS idx_compliance_scores ON compliance_scores (entity_type, entity_id, score_date DESC);

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

-- Financial Years
INSERT INTO financial_years (fy_code, display_name, start_date, end_date, is_current) VALUES
('2020-21', 'FY 2020-2021', '2020-04-01', '2021-03-31', false),
('2021-22', 'FY 2021-2022', '2021-04-01', '2022-03-31', false),
('2022-23', 'FY 2022-2023', '2022-04-01', '2023-03-31', false),
('2023-24', 'FY 2023-2024', '2023-04-01', '2024-03-31', true),
('2024-25', 'FY 2024-2025', '2024-04-01', '2025-03-31', false)
ON CONFLICT (fy_code) DO NOTHING;

-- GST Rates
INSERT INTO gst_rates (rate, cgst_rate, sgst_rate, igst_rate, description, effective_from) VALUES
(0.00, 0.00, 0.00, 0.00, 'Exempt/Nil Rated', '2017-07-01'),
(0.25, 0.125, 0.125, 0.25, '0.25% - Rough precious stones', '2017-07-01'),
(3.00, 1.50, 1.50, 3.00, '3% - Gold/Articles', '2017-07-01'),
(5.00, 2.50, 2.50, 5.00, '5% - Essential goods', '2017-07-01'),
(12.00, 6.00, 6.00, 12.00, '12% - Processed foods', '2017-07-01'),
(18.00, 9.00, 9.00, 18.00, '18% - Most goods and services', '2017-07-01'),
(28.00, 14.00, 14.00, 28.00, '28% - Luxury/sin goods', '2017-07-01')
ON CONFLICT DO NOTHING;

-- HSN/SAC Codes
INSERT INTO hsn_sac_codes (code, code_type, description, chapter, gst_rate, is_service) VALUES
('9963', 'SAC', 'Accounting and bookkeeping services', '99', 18.00, true),
('9971', 'SAC', 'Legal services', '99', 18.00, true),
('9985', 'SAC', 'IT services', '99', 18.00, true),
('9986', 'SAC', 'Management consulting services', '99', 18.00, true),
('9997', 'SAC', 'Other services', '99', 18.00, true),
('8703', 'HSN', 'Motor cars and other motor vehicles principally designed for the transport of persons', '87', 28.00, false),
('9403', 'HSN', 'Other furniture and parts thereof', '94', 18.00, false),
('8471', 'HSN', 'Automatic data processing machines and units thereof', '84', 18.00, false)
ON CONFLICT DO NOTHING;

-- ITC Blocked Categories
INSERT INTO itc_blocked_categories (category_code, category_name, gst_section, description, effective_from) VALUES
('MOTOR_VEHICLES', 'Motor Vehicles', '17(5)(a)', 'Motor vehicles for transportation of persons having seating capacity <= 13', '2017-07-01'),
('FOOD_BEVERAGES', 'Food & Beverages', '17(5)(b)', 'Food and beverages, outdoor catering, beauty treatment, health services', '2017-07-01'),
('TRAVEL_BENEFITS', 'Travel Benefits', '17(5)(b)', 'Travel benefits to employees', '2017-07-01'),
('WORKS_CONTRACT', 'Works Contract', '17(5)(c)', 'Works contract for construction of immovable property', '2017-07-01'),
('COMPOSITION_SCHEME', 'Composition Scheme', '17(4)', 'Goods/services received from composition dealers', '2017-07-01')
ON CONFLICT (category_code) DO NOTHING;

-- Basic GST Rules
INSERT INTO gst_rules_master (rule_code, rule_name, rule_category, gst_section, description, rule_condition, rule_action, effective_from, version) VALUES
('ITC_TIME_LIMIT', 'ITC Time Limit', 'TIMING', '16(4)', 'ITC must be claimed by earlier of Annual Return filing or September of next FY', '{"condition": "invoice_date < financial_year_end AND current_date > time_limit_date"}', 'REJECT_ITC', '2017-07-01', 1),
('180_DAY_RULE', '180 Day Payment Rule', 'PAYMENT', '16(2)', 'ITC must be reversed if payment not made to supplier within 180 days', '{"condition": "payment_status = ''UNPAID'' AND days_since_invoice > 180"}', 'REVERSE_ITC', '2017-07-01', 1),
('RCM_ELIGIBILITY', 'RCM ITC Eligibility', 'RCM', '9(3)/(4)', 'ITC on RCM available only after payment made in cash ledger', '{"condition": "reverse_charge = true AND cash_payment_date IS NULL"}', 'DEFER_ITC', '2017-07-01', 1)
ON CONFLICT (rule_code) DO NOTHING;

-- ============================================
-- FINAL SETUP COMMANDS COMMENT
-- ============================================

/*
TO COMPLETE SETUP:

1. Create default admin user (example):
   INSERT INTO users (email, full_name, email_verified, is_active) 
   VALUES ('admin@example.com', 'System Administrator', true, true)
   ON CONFLICT (email) DO NOTHING;

2. Create default tenant and workspace:
   INSERT INTO tenants (tenant_code, legal_name, subscription_plan, subscription_status)
   VALUES ('default', 'Default Organization', 'ENTERPRISE', 'ACTIVE')
   ON CONFLICT (tenant_code) DO NOTHING;
   
   INSERT INTO workspaces (workspace_code, name, workspace_type)
   VALUES ('default', 'Default Workspace', 'COMPANY')
   ON CONFLICT (workspace_code) DO NOTHING;

3. For production, consider:
   - Setting up logical replication for audit_trail
   - Configuring connection pooling (PgBouncer)
   - Setting up monitoring alerts
   - Regular VACUUM ANALYZE schedules
*/

-- ============================================
-- DATABASE SUMMARY
-- ============================================

-- COMMENT ON DATABASE gst_recon IS 'GST Reconciliation SaaS Platform - Complete Database Schema (52 Tables)';

-- Table Count Verification
DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE';
    
    RAISE NOTICE 'Total tables created: % (Expected: 52)', table_count;
    
    IF table_count = 52 THEN
        RAISE NOTICE '✅ Database schema created successfully with all 52 tables';
    ELSE
        RAISE WARNING '⚠️ Table count mismatch. Expected 52, found %', table_count;
    END IF;
END $$;
