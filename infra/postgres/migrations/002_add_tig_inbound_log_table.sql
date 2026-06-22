-- ============================================================
-- MIGRATION 002: tig_inbound_outbound_log (ERP Connector Logs)
-- Created: 2026-06-02
-- Purpose: Logs inbound/outbound API requests/responses for ERP connectors.
-- ============================================================

CREATE TABLE IF NOT EXISTS tig_inbound_outbound_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(255),
    request_type    VARCHAR(255),
    user_id         VARCHAR(255),
    tenant_id       VARCHAR(255),
    org_id          VARCHAR(255),
    access_key      VARCHAR(255), -- api_key
    platform        VARCHAR(255),
    t_params        JSONB,
    t_resp_headers  JSONB,
    t_resp_body     JSONB,
    ip_address      VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    user_agent      VARCHAR(255),
    status          VARCHAR(255), -- success, error, pending
    extrainfo       JSONB
);

-- Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_org ON tig_inbound_outbound_log (org_id);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_tenant ON tig_inbound_outbound_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_type ON tig_inbound_outbound_log (type);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_status ON tig_inbound_outbound_log (status);
CREATE INDEX IF NOT EXISTS idx_tig_inbound_outbound_log_created ON tig_inbound_outbound_log (created_at);

COMMENT ON TABLE tig_inbound_outbound_log IS 'Logs inbound and outbound API request and response details for ERP connector integrations.';

