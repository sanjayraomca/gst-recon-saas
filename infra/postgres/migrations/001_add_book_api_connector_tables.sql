-- ============================================================
-- MIGRATION 001: workspace_api_keys (FINAL SCHEMA)
-- Created: 2026-05-14
-- Purpose: One API key record per workspace with separate
--          production_key and sandbox_key.
--          Only SUPER_ADMIN can create/manage these records.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX IF NOT EXISTS idx_api_keys_prod_key     ON workspace_api_keys (production_key); -- Fast lookup on inbound auth
CREATE INDEX IF NOT EXISTS idx_api_keys_sand_key     ON workspace_api_keys (sandbox_key);    -- Fast lookup on inbound auth

-- Auto-update trigger for updated_at
DROP TRIGGER IF EXISTS update_workspace_api_keys_updated_at ON workspace_api_keys;
CREATE TRIGGER update_workspace_api_keys_updated_at
    BEFORE UPDATE ON workspace_api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE workspace_api_keys IS
    'API credentials for external ERP connectors. One record per workspace. Only SUPER_ADMIN can create/manage. production_key for live data, sandbox_key for testing.';
COMMENT ON COLUMN workspace_api_keys.production_key IS 'Live key for real Purchase/Sales register ingestion.';
COMMENT ON COLUMN workspace_api_keys.sandbox_key    IS 'Demo/test key — data pushed with this key is flagged as demo.';
COMMENT ON COLUMN workspace_api_keys.mode           IS 'Current active mode for the workspace connector: live or demo.';
COMMENT ON COLUMN workspace_api_keys.status         IS 'active = keys are valid; inactive = all inbound pushes rejected.';

-- ============================================================
-- END OF MIGRATION 001
-- ============================================================
