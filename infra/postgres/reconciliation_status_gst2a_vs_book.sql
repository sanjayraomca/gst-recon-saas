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
