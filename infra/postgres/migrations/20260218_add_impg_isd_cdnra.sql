-- Migration: Add GSTR-2B IMPG, ISD and CDNRA tables
-- Date: 2026-02-18

-- Imports of Goods (IMPG) table
CREATE TABLE IF NOT EXISTS gstr_2b_impg (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    import_filing_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    
    port_code VARCHAR(20),
    boe_number VARCHAR(50) NOT NULL,
    boe_date DATE NOT NULL,
    return_period VARCHAR(50),
    icegate_ref_date DATE,
    
    taxable_value NUMERIC(15, 2) DEFAULT 0,
    integrated_tax NUMERIC(15, 2) DEFAULT 0,
    cess NUMERIC(15, 2) DEFAULT 0,
    
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(50),

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
    return_period VARCHAR(50),
    
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
    note_type VARCHAR(50),
    
    original_invoice_number VARCHAR(50),
    original_invoice_date DATE,
    
    return_period VARCHAR(50),
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
    supplier_filing_period VARCHAR(50),
    supplier_filing_date DATE,
    itc_availability VARCHAR(5) DEFAULT 'Yes',
    itc_availability_reason TEXT,
    applicable_tax_rate VARCHAR(50),
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
