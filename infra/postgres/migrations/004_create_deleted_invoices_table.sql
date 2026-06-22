-- ============================================================
-- MIGRATION 004: deleted_invoices
-- Created: 2026-06-06
-- Purpose: Audit log of deleted invoices from book data or gst data.
-- ============================================================

CREATE TABLE IF NOT EXISTS deleted_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(50) NOT NULL CHECK (type IN ('book data', 'gst data')),
    subtype         VARCHAR(100),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    main_data       JSONB,
    line_items      JSONB,
    ref_table_info  JSONB,
    ip_address      VARCHAR(45),
    remark          TEXT,
    deleted_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    t_extra_info    JSONB
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_tenant ON deleted_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_workspace ON deleted_invoices (workspace_id);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_type_subtype ON deleted_invoices (type, subtype);
CREATE INDEX IF NOT EXISTS idx_deleted_invoices_deleted_at ON deleted_invoices (deleted_at);

COMMENT ON TABLE deleted_invoices IS 'Audit log of deleted invoices from book data or gst data.';
