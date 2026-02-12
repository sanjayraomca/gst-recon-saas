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
    compliance_score INTEGER DEFAULT 85,
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

-- ============================================
-- DOMAIN 2: GST MASTER DATA (6 tables)
-- ============================================

CREATE TABLE gstin_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gstin CHAR(15) UNIQUE NOT NULL,
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
    gstin_pwd_encrypted TEXT,
    password_updated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    compliance_score NUMERIC(5,2) DEFAULT 100.00,
    last_filing_date DATE,
    next_filing_due_date DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE gstr_import_file_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gstin VARCHAR(15) NOT NULL,
    return_period VARCHAR(10) NOT NULL, -- Format: MMYYYY
    filing_date DATE,
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, PROCESSED, ERROR
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (gstin, return_period)
);


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
