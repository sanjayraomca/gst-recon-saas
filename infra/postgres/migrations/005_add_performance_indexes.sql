-- ============================================================
-- MIGRATION 005: PERFORMANCE INDEXES
-- Adds missing indexes on hot query paths across all major tables.
-- All indexes use IF NOT EXISTS — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. PURCHASE VOUCHERS
-- Hot path: workspace listing, period filter, supplier search
-- ============================================================

-- Core listing index (workspace + period — covers almost every UI grid query)
CREATE INDEX IF NOT EXISTS idx_pv_workspace_period
    ON purchase_vouchers (workspace_id, tax_period_id);

-- Supplier GSTIN filter (reconciliation matching + supplier reports)
CREATE INDEX IF NOT EXISTS idx_pv_supplier_gstin
    ON purchase_vouchers (workspace_id, supplier_gstin);

-- Voucher/invoice number search (partial match lookups, reconciliation)
CREATE INDEX IF NOT EXISTS idx_pv_supplier_invoice_no
    ON purchase_vouchers (workspace_id, supplier_invoice_no);

-- Soft-delete filter — skip deleted rows cheaply
CREATE INDEX IF NOT EXISTS idx_pv_is_deleted
    ON purchase_vouchers (workspace_id, is_deleted)
    WHERE is_deleted = FALSE;

-- Book type filter (PA/CN/DN/EXP segmentation in the listing grid)
CREATE INDEX IF NOT EXISTS idx_pv_book_type
    ON purchase_vouchers (workspace_id, book_type);

-- Supplier invoice date range queries
CREATE INDEX IF NOT EXISTS idx_pv_invoice_date
    ON purchase_vouchers (workspace_id, supplier_invoice_date DESC);

-- ============================================================
-- 2. PURCHASE ITEMS
-- Hot path: line-item aggregation by purchase parent
-- ============================================================

-- purchase_id lookup is the primary join from purchase_vouchers
CREATE INDEX IF NOT EXISTS idx_pi_purchase_id
    ON purchase_items (purchase_id);

-- HSN code filtering / grouping
CREATE INDEX IF NOT EXISTS idx_pi_hsn_code
    ON purchase_items (hsn_code);

-- ============================================================
-- 3. SALES INVOICES
-- Hot path: workspace listing, period filter, customer search
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_si_workspace_period
    ON sales_invoices (workspace_id, tax_period_id);

CREATE INDEX IF NOT EXISTS idx_si_customer_gstin
    ON sales_invoices (workspace_id, customer_gstin);

CREATE INDEX IF NOT EXISTS idx_si_invoice_date
    ON sales_invoices (workspace_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_si_book_type
    ON sales_invoices (workspace_id, book_type);

-- ============================================================
-- 4. RECONCILIATION RUNS & RESULTS
-- Hot path: fetching run list + result rows for a workspace/period
-- ============================================================

-- Reconciliation run listing (workspace + status + most recent)
CREATE INDEX IF NOT EXISTS idx_recon_runs_workspace_status
    ON reconciliation_runs (workspace_id, status, created_at DESC);

-- Period-based run filtering
CREATE INDEX IF NOT EXISTS idx_recon_runs_period
    ON reconciliation_runs (workspace_id, period_id);

-- Results: fetch all rows for a given run (primary join pattern)
CREATE INDEX IF NOT EXISTS idx_recon_results_run_id
    ON reconciliation_results (recon_run_id);

-- Results: filter by match_status within a workspace
CREATE INDEX IF NOT EXISTS idx_recon_results_ws_status
    ON reconciliation_results (workspace_id, match_status);

-- Results: filter by ITC decision
CREATE INDEX IF NOT EXISTS idx_recon_results_itc
    ON reconciliation_results (workspace_id, itc_decision);

-- ============================================================
-- 5. RECONCILIATION STATUS (workflow status table)
-- Hot path: JOIN in reconciliation results query
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_recon_status_book_data
    ON reconciliation_status (workspace_id, book_data_id)
    WHERE book_data_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recon_status_gstr_data
    ON reconciliation_status (workspace_id, gstr_data_id)
    WHERE gstr_data_id IS NOT NULL;

-- ============================================================
-- 6. TIG INBOUND/OUTBOUND LOG
-- Hot path: connector log page listing with filters + stats
-- ============================================================

-- Composite index for the common listing query (org + created_at desc)
CREATE INDEX IF NOT EXISTS idx_tig_log_org_created
    ON tig_inbound_outbound_log (org_id, created_at DESC);

-- Platform filter (Adesk / Tally / Zoho)
CREATE INDEX IF NOT EXISTS idx_tig_log_platform
    ON tig_inbound_outbound_log (platform, created_at DESC);

-- Request type filter
CREATE INDEX IF NOT EXISTS idx_tig_log_request_type
    ON tig_inbound_outbound_log (request_type, created_at DESC);

-- ============================================================
-- 7. GSTIN MASTER
-- Hot path: GSTIN lookup during reconciliation
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_gstin_master_workspace
    ON gstin_master (id);  -- already PK, but add for workspace join if needed

-- ============================================================
-- 8. SUPPLIER & CUSTOMER MASTER
-- Hot path: name/GSTIN search in dropdowns + supplier page
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_supplier_master_gstin
    ON supplier_master (workspace_id, gstin);

CREATE INDEX IF NOT EXISTS idx_supplier_master_name
    ON supplier_master (workspace_id, supplier_name);

CREATE INDEX IF NOT EXISTS idx_customer_master_gstin
    ON customer_master (workspace_id, gstin);

CREATE INDEX IF NOT EXISTS idx_customer_master_name
    ON customer_master (workspace_id, customer_name);

-- ============================================================
-- 9. GSTR IMPORT MASTER
-- Hot path: import history listing per workspace
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_gstr_import_ws_status
    ON gstr_import_master (workspace_id, status, upload_timestamp DESC);

-- ============================================================
-- VERIFICATION QUERY
-- Run this after applying to confirm all indexes exist:
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
-- ============================================================
