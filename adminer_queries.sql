-- ============================================================
-- ADVANCED RECONCILIATION — ADMINER SQL REFERENCE
-- Replace placeholders like 'YOUR_WORKSPACE_ID' and 'YOUR_RUN_ID'
-- with real UUIDs from your database before running.
-- ============================================================


-- ============================================================
-- 0. UTILITY — Find your workspace_id and run_id
-- ============================================================

-- List all workspaces
SELECT id, name, tenant_id FROM workspaces ORDER BY created_at DESC;

-- List all reconciliation runs (most recent first)
SELECT
    id            AS run_id,
    workspace_id,
    gstin_id,
    period_id,
    run_type,
    status,
    matched_count,
    mismatched_count,
    missing_count,
    started_at,
    completed_at
FROM reconciliation_runs
WHERE workspace_id = 'YOUR_WORKSPACE_ID'
ORDER BY created_at DESC
LIMIT 20;

-- List tax periods
SELECT id, period_code, month, year, quarter, fy_id FROM tax_periods ORDER BY year DESC, month DESC;

-- List GSTINs for a workspace
SELECT id, gstin, name FROM gstin_master WHERE workspace_id = 'YOUR_WORKSPACE_ID';


-- ============================================================
-- 1. MAIN DATA FETCH — Advanced Reconciliation Page
-- Equivalent to: GET /reconciliation/runs/:run_id/results
-- Replace: YOUR_WORKSPACE_ID, YOUR_RUN_ID
-- ============================================================

SELECT
    -- Reconciliation result metadata
    rr.id                                           AS result_id,
    rr.match_status,
    rr.match_score,
    rr.match_confidence,
    rr.variance_amount,
    rr.itc_decision,
    rr.decision_reason,
    rr.action_required,
    rr.action_status,

    -- Supplier Identity (prefer Books side, fallback to GSTR-2B)
    COALESCE(pi.supplier_gstin, gi.supplier_gstin)  AS supplier_gstin,
    COALESCE(pi.supplier_name, gi.supplier_name)    AS supplier_name,

    -- GST category
    COALESCE(pi.source_section, gi.source_section)  AS gst_type,
    pi.gstr_category                                AS gst_cat,

    -- Invoice date (prefer Books)
    COALESCE(pi.supplier_invoice_no, gi.document_number_clean) AS invoice_no,
    COALESCE(pi.supplier_invoice_date, gi.document_date)       AS invoice_date,

    -- Books voucher reference
    pi.book_vchr_no                                 AS voucher_no,
    pi.book_vchr_date                               AS voucher_date,
    pi.voucher_type                                 AS book_type,

    -- Period
    COALESCE(tp.period_code, gi.return_period)      AS return_period,
    fymas.fy_code                                   AS financial_year,

    -- GSTR-2B amounts
    gi.document_value                               AS gstr_invoice_total,
    gi.taxable_value                                AS gstr_taxable,
    COALESCE(gi.igst, 0)                            AS gstr_igst,
    COALESCE(gi.cgst, 0)                            AS gstr_cgst,
    COALESCE(gi.sgst, 0)                            AS gstr_sgst,
    COALESCE(gi.cess, 0)                            AS gstr_cess,
    COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0) AS gstr_tax,
    CASE
        WHEN gi.taxable_value > 0
        THEN ROUND(((COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))/gi.taxable_value)*100)
        ELSE 0
    END AS gstr_tax_rate,
    gi.itc_available,
    gi.itc_eligibility,

    -- GSTR-2B invoice identity
    gi.document_number_clean                        AS gstr2b_invoice_no,
    gi.document_date                                AS gstr2b_invoice_date,
    gi.return_period                                AS gstr2b_return_period,
    gi.filing_date                                  AS gstr2b_filing_date,
    gi.reverse_charge                               AS gstr2b_reverse_charge,
    gi.place_of_supply                              AS gstr2b_pos,
    gi.original_invoice_number                      AS gstr2b_amendment_original_inv,

    -- Books (Purchase Vouchers) amounts
    pi.net_amount                                   AS book_invoice_total,
    pi.taxable_total                                AS book_taxable,
    COALESCE(pi.total_igst_amount, 0)               AS book_igst,
    COALESCE(pi.total_cgst_amount, 0)               AS book_cgst,
    COALESCE(pi.total_sgst_amount, 0)               AS book_sgst,
    COALESCE(pi.total_cess_amount, 0)               AS book_cess,
    COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0) AS book_tax,

    -- Workflow / action status
    COALESCE(rs_pi.recon_status, rs_gi.recon_status, 'pending') AS workflow_status

FROM reconciliation_results AS rr
LEFT JOIN purchase_vouchers              AS pi     ON rr.purchase_invoice_id = pi.id
LEFT JOIN normalized_gstr2b_invoices    AS gi     ON rr.gstr2b_invoice_id   = gi.id
LEFT JOIN tax_periods                   AS tp     ON tp.id = pi.tax_period_id
                                                  OR (tp.period_code = gi.return_period AND pi.tax_period_id IS NULL)
LEFT JOIN financial_years               AS fymas  ON tp.fy_id = fymas.id
LEFT JOIN reconciliation_status         AS rs_pi  ON rr.purchase_invoice_id = rs_pi.book_data_id
LEFT JOIN reconciliation_status         AS rs_gi  ON rr.gstr2b_invoice_id   = rs_gi.gstr_data_id

WHERE
    rr.recon_run_id = 'YOUR_RUN_ID'
    -- Skip rows where GSTIN is NULL or empty on both sides
    AND (pi.supplier_gstin IS NOT NULL OR gi.supplier_gstin IS NOT NULL)
    AND (pi.supplier_gstin != '' OR gi.supplier_gstin != '')

ORDER BY rr.created_at DESC
LIMIT 50;


-- ============================================================
-- 2. ALL FILTERS — Usage Guide & Queries
-- Add any of the WHERE clauses below to Query #1
-- ============================================================

-- ── 2A. Filter by Match Status ──────────────────────────────
-- Possible values: matched, mismatch, partial_match, missing_in_2b,
--                  missing_in_books, not_eligible
AND rr.match_status IN ('matched', 'mismatch')
-- Single value:
AND rr.match_status = 'missing_in_2b'

-- ── 2B. Filter by Workflow / Action Status ──────────────────
-- Possible values: pending, claimed, mismatched, resolved
AND COALESCE(rs_pi.recon_status, rs_gi.recon_status, 'pending') IN ('pending')

-- ── 2C. Filter by Supplier GSTIN ────────────────────────────
AND (pi.supplier_gstin = '29ABCDE1234F1Z5' OR gi.supplier_gstin = '29ABCDE1234F1Z5')
-- Multiple GSTINs:
AND (pi.supplier_gstin IN ('GSTIN1','GSTIN2') OR gi.supplier_gstin IN ('GSTIN1','GSTIN2'))

-- ── 2D. Filter by Invoice Date Range ────────────────────────
AND (pi.supplier_invoice_date >= '2025-04-01' OR gi.document_date >= '2025-04-01')
AND (pi.supplier_invoice_date <= '2025-06-30' OR gi.document_date <= '2025-06-30')

-- ── 2E. Filter by Financial Year (Indian FY Apr-Mar) ─────────
-- Example: FY 2025-26 → Apr 2025 to Mar 2026
AND (
    (EXTRACT(YEAR FROM pi.supplier_invoice_date) = 2025 AND EXTRACT(MONTH FROM pi.supplier_invoice_date) >= 4)
    OR
    (EXTRACT(YEAR FROM pi.supplier_invoice_date) = 2026 AND EXTRACT(MONTH FROM pi.supplier_invoice_date) <= 3)
    OR
    (EXTRACT(YEAR FROM gi.document_date) = 2025 AND EXTRACT(MONTH FROM gi.document_date) >= 4)
    OR
    (EXTRACT(YEAR FROM gi.document_date) = 2026 AND EXTRACT(MONTH FROM gi.document_date) <= 3)
)

-- ── 2F. Filter by Quarter (Indian FY) ───────────────────────
-- Q1 = Apr-Jun (months 4,5,6), Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
AND (
    EXTRACT(MONTH FROM pi.supplier_invoice_date)::int IN (4, 5, 6)
    AND EXTRACT(YEAR FROM pi.supplier_invoice_date) = 2025
    OR
    EXTRACT(MONTH FROM gi.document_date)::int IN (4, 5, 6)
    AND EXTRACT(YEAR FROM gi.document_date) = 2025
)

-- ── 2G. Filter by Specific Month ────────────────────────────
-- Example: April 2025 (month=4, year=2025)
AND (
    (EXTRACT(MONTH FROM pi.supplier_invoice_date) = 4 AND EXTRACT(YEAR FROM pi.supplier_invoice_date) = 2025)
    OR
    (EXTRACT(MONTH FROM gi.document_date) = 4 AND EXTRACT(YEAR FROM gi.document_date) = 2025)
)

-- ── 2H. Filter by Place of Supply ───────────────────────────
AND (pi.place_of_supply IN ('Karnataka', '29') OR gi.place_of_supply IN ('Karnataka', '29'))

-- ── 2I. Filter by Amount Range ──────────────────────────────
AND (pi.net_amount >= 10000 OR gi.document_value >= 10000)   -- min amount
AND (pi.net_amount <= 500000 OR gi.document_value <= 500000) -- max amount

-- ── 2J. Filter: Has Variance ────────────────────────────────
AND rr.variance_amount != 0

-- ── 2K. Filter: Action Required ─────────────────────────────
AND rr.action_required IS NOT NULL

-- ── 2L. Column filter: by Invoice Number (partial match) ────
AND (
    pi.supplier_invoice_no ILIKE '%INV123%'
    OR gi.document_number_clean ILIKE '%INV123%'
)

-- ── 2M. Column filter: by Voucher Number ────────────────────
AND pi.book_vchr_no ILIKE '%VCH456%'

-- ── 2N. Global Search (name / gstin / invoice no) ───────────
AND (
    pi.supplier_name ILIKE '%sagar%'
    OR gi.supplier_name ILIKE '%sagar%'
    OR pi.supplier_invoice_no ILIKE '%sagar%'
    OR gi.document_number_clean ILIKE '%sagar%'
    OR pi.supplier_gstin ILIKE '%sagar%'
    OR gi.supplier_gstin ILIKE '%sagar%'
)

-- ── 2O. Period filter by exact period_code (e.g. 042025) ───
AND (tp.period_code = '042025' OR gi.return_period = '042025')

-- ── 2P. Exact Numeric column filter ─────────────────────────
-- e.g. Book Tax = 1891.48
AND ROUND(COALESCE((COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0))::numeric, 0)::numeric, 2) = 1891.48


-- ============================================================
-- 3. TAX SUMMARY OUTPUT
-- Equivalent to: GET /reconciliation/runs/:run_id/tax-summary
-- Two parts: (A) aggregated totals, (B) invoice-level rows
-- ============================================================

-- ── 3A. Period + Category Aggregation (Top-level summary) ───
SELECT
    COALESCE(tp.period_code, gi.return_period, '000000')        AS period,
    UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) AS category,

    -- Books side
    COUNT(pi.id)                                                AS books_count,
    SUM(COALESCE(pi.total_igst_amount, 0))                      AS books_igst,
    SUM(COALESCE(pi.total_cgst_amount, 0))                      AS books_cgst,
    SUM(COALESCE(pi.total_sgst_amount, 0))                      AS books_sgst,
    SUM(
        COALESCE(pi.total_igst_amount, 0) +
        COALESCE(pi.total_cgst_amount, 0) +
        COALESCE(pi.total_sgst_amount, 0) +
        COALESCE(pi.total_cess_amount, 0)
    )                                                           AS books_tax,

    -- GSTR-2B side
    COUNT(gi.id)                                                AS gstr2b_count,
    SUM(COALESCE(gi.igst, 0))                                   AS gstr2b_igst,
    SUM(COALESCE(gi.cgst, 0))                                   AS gstr2b_cgst,
    SUM(COALESCE(gi.sgst, 0))                                   AS gstr2b_sgst,
    SUM(
        COALESCE(gi.igst, 0) +
        COALESCE(gi.cgst, 0) +
        COALESCE(gi.sgst, 0) +
        COALESCE(gi.cess, 0)
    )                                                           AS gstr2b_tax,

    -- Difference
    COUNT(pi.id) - COUNT(gi.id)                                  AS diff_count,
    SUM(
        COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0)
        - COALESCE(gi.igst,0)-COALESCE(gi.cgst,0)-COALESCE(gi.sgst,0)-COALESCE(gi.cess,0)
    )                                                           AS diff_tax

FROM reconciliation_results AS rr
LEFT JOIN purchase_vouchers           AS pi ON rr.purchase_invoice_id = pi.id
LEFT JOIN normalized_gstr2b_invoices  AS gi ON rr.gstr2b_invoice_id   = gi.id
LEFT JOIN tax_periods                 AS tp ON tp.id = pi.tax_period_id

WHERE
    rr.recon_run_id  = 'YOUR_RUN_ID'
    AND rr.workspace_id = 'YOUR_WORKSPACE_ID'

    -- ── Optional period filters (uncomment as needed) ──────
    -- Full FY 2025-26 filter:
    -- AND COALESCE(tp.period_code, gi.return_period) IN (
    --     '042025','052025','062025','072025','082025','092025',
    --     '102025','112025','122025','012026','022026','032026'
    -- )
    -- Specific month (April 2025 = 042025):
    -- AND (tp.period_code = '042025' OR gi.return_period = '042025')
    -- Quarter 1 (04,05,06 of 2025):
    -- AND COALESCE(tp.period_code, gi.return_period) IN ('042025','052025','062025')

GROUP BY
    COALESCE(tp.period_code, gi.return_period, '000000'),
    UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'))
ORDER BY
    COALESCE(tp.period_code, gi.return_period, '000000'),
    UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'));


-- ── 3B. Invoice-level rows (drilled down in Tax Summary) ───
SELECT
    COALESCE(tp.period_code, gi.return_period, '000000')           AS period,
    UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) AS category,
    rr.id                                                          AS result_id,
    rr.match_status,
    COALESCE(pi.supplier_name, gi.supplier_name)                   AS supplier_name,
    COALESCE(pi.supplier_gstin, gi.supplier_gstin)                 AS supplier_gstin,
    COALESCE(pi.supplier_invoice_no, gi.document_number_clean)     AS invoice_no,
    COALESCE(pi.supplier_invoice_date, gi.document_date)           AS invoice_date,

    -- Books tax
    COALESCE(pi.total_igst_amount,0)+COALESCE(pi.total_cgst_amount,0)+COALESCE(pi.total_sgst_amount,0)+COALESCE(pi.total_cess_amount,0) AS books_tax,
    pi.total_igst_amount AS books_igst,
    pi.total_cgst_amount AS books_cgst,
    pi.total_sgst_amount AS books_sgst,

    -- GSTR-2B tax
    COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0) AS gstr2b_tax,
    gi.igst AS gstr2b_igst,
    gi.cgst AS gstr2b_cgst,
    gi.sgst AS gstr2b_sgst,

    -- Voucher reference
    pi.book_vchr_no AS vchr_no,
    pi.gstr_category

FROM reconciliation_results AS rr
LEFT JOIN purchase_vouchers           AS pi ON rr.purchase_invoice_id = pi.id
LEFT JOIN normalized_gstr2b_invoices  AS gi ON rr.gstr2b_invoice_id   = gi.id
LEFT JOIN tax_periods                 AS tp ON tp.id = pi.tax_period_id

WHERE
    rr.recon_run_id  = 'YOUR_RUN_ID'
    AND rr.workspace_id = 'YOUR_WORKSPACE_ID'

ORDER BY
    COALESCE(tp.period_code, gi.return_period, '000000'),
    UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'));
