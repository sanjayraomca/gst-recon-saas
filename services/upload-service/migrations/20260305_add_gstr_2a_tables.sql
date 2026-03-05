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
