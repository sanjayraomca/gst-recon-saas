-- Migration: Add total_qty and discount to expense_vouchers
-- Date: 2026-02-21

BEGIN;

ALTER TABLE expense_vouchers 
    ADD COLUMN IF NOT EXISTS total_qty NUMERIC(15, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount NUMERIC(15, 2) DEFAULT 0;

-- Update net_amount calculation logic in comments/docs if necessary
-- Formula: net_amount = taxable_total + total_taxes - discount + round_off

COMMIT;
