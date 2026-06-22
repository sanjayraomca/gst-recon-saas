-- MIGRATION 003: Fix reconciliation results foreign key delete rules
-- This migrates constraints to ON DELETE CASCADE so undoing GSTR imports works correctly.

-- Table: reconciliation_results
ALTER TABLE reconciliation_results 
  DROP CONSTRAINT IF EXISTS reconciliation_results_gstr2b_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS reconciliation_results_gstr2a_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS reconciliation_results_gstr2a_source_id_fkey;

ALTER TABLE reconciliation_results
  ADD CONSTRAINT reconciliation_results_gstr2b_invoice_id_fkey 
    FOREIGN KEY (gstr2b_invoice_id) REFERENCES normalized_gstr2b_invoices(id) ON DELETE CASCADE,
  ADD CONSTRAINT reconciliation_results_gstr2a_invoice_id_fkey 
    FOREIGN KEY (gstr2a_invoice_id) REFERENCES normalized_gstr2a_invoices(id) ON DELETE CASCADE,
  ADD CONSTRAINT reconciliation_results_gstr2a_source_id_fkey 
    FOREIGN KEY (gstr2a_source_id) REFERENCES normalized_gstr2a_invoices(id) ON DELETE CASCADE;

-- Table: reconciliation_results_2a
ALTER TABLE reconciliation_results_2a
  DROP CONSTRAINT IF EXISTS reconciliation_results_2a_gstr2a_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS reconciliation_results_2a_gstr2a_source_id_fkey,
  DROP CONSTRAINT IF EXISTS reconciliation_results_2a_gstr2b_invoice_id_fkey;

ALTER TABLE reconciliation_results_2a
  ADD CONSTRAINT reconciliation_results_2a_gstr2a_invoice_id_fkey 
    FOREIGN KEY (gstr2a_invoice_id) REFERENCES normalized_gstr2a_invoices(id) ON DELETE CASCADE,
  ADD CONSTRAINT reconciliation_results_2a_gstr2a_source_id_fkey 
    FOREIGN KEY (gstr2a_source_id) REFERENCES normalized_gstr2a_invoices(id) ON DELETE CASCADE,
  ADD CONSTRAINT reconciliation_results_2a_gstr2b_invoice_id_fkey 
    FOREIGN KEY (gstr2b_invoice_id) REFERENCES normalized_gstr2b_invoices(id) ON DELETE CASCADE;
