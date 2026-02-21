-- Migration: Enhance Expense Voucher Schema for Accuracy and GST Compliance
-- Date: 2026-02-21

BEGIN;

-- 1. Enhance expense_vouchers table
ALTER TABLE expense_vouchers 
    ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_interstate BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_rcm BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS round_off NUMERIC(8, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS book_type VARCHAR(2) 
        CHECK (book_type IN ('SA','SR','CN','DN')), -- Parity with sales_invoices
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT' 
        CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
    ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Add unique constraint to prevent duplicates
-- Refined to include book_type and tax_period_id based on real data
ALTER TABLE expense_vouchers
    DROP CONSTRAINT IF EXISTS uq_expense_voucher_invoice;

ALTER TABLE expense_vouchers
    ADD CONSTRAINT uq_expense_voucher_invoice 
    UNIQUE (tenant_id, workspace_id, book_type, supplier_invoice_no, tax_period_id);

-- 2. Enhance expense_items table
ALTER TABLE expense_items
    ADD COLUMN IF NOT EXISTS itc_eligible BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS itc_block_reason TEXT;

COMMIT;
