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
    return_period VARCHAR(50),
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
    note_type VARCHAR(50),                          -- Credit / Debit
    note_number VARCHAR(50) NOT NULL,
    note_date DATE NOT NULL,
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
