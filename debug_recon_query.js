// Debug script to simulate exact reconciliation query for invoice 5532763396
const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: (process.env.DB_HOST === 'postgres-main' ? '127.0.0.1' : process.env.DB_HOST) || '127.0.0.1',
    port: process.env.DB_PORT || 5435,
    database: process.env.DB_NAME || 'gst_recon',
    user: process.env.DB_USER || 'gstadmin',
    password: process.env.DB_PASSWORD || 'GstAdmin123',
};

async function debug() {
    const client = new Client(dbConfig);
    await client.connect();

    // Step 1: What does the reconciliation_results row look like?
    console.log('\n=== STEP 1: reconciliation_results row ===');
    const rr = await client.query(`
        SELECT rr.*, gi.document_number_clean, gi.document_date, gi.document_value, gi.taxable_value, 
               gi.igst, gi.cgst, gi.sgst, gi.cess, gi.total_tax, gi.supplier_gstin, gi.supplier_name,
               gi.source_section,
               pi.supplier_invoice_no as book_inv_no, pi.supplier_invoice_date as book_inv_date, 
               pi.net_amount as book_net, pi.taxable_total as book_taxable
        FROM reconciliation_results rr
        LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
        LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
        WHERE gi.document_number_clean = '5532763396'
    `);
    console.log(JSON.stringify(rr.rows, null, 2));

    // Step 2: What does the FULL reconcilation model query return for this specific record?
    console.log('\n=== STEP 2: Full query with all COALESCE fields ===');
    const full = await client.query(`
        SELECT 
            rr.id,
            rr.match_status,
            rr.portal_value,
            rr.books_value,
            
            -- Supplier mapping (same as reconciliationModel.js)
            COALESCE(pi.supplier_name, gi.supplier_name) as supplier_name,
            COALESCE(pi.supplier_gstin, gi.supplier_gstin) as supplier_gstin,
            COALESCE(pi.supplier_invoice_no, gi.document_number_clean, gi.isd_document_number, gi.boe_number) as supplier_invoice_no,
            COALESCE(pi.supplier_invoice_date, gi.document_date, gi.isd_document_date, gi.boe_date) as supplier_invoice_date,
            
            -- Books mapping
            pi.supplier_invoice_no as purchase_invoice_number,
            COALESCE(pi.supplier_invoice_date, pi.book_vchr_date) as purchase_invoice_date,
            COALESCE(pi.net_amount, 0) as purchase_invoice_total,
            COALESCE(pi.taxable_total, 0) as purchase_taxable,
            
            -- Portal mapping (what we changed)
            COALESCE(gi.document_number_clean, gi.isd_document_number, gi.boe_number) as gstr_invoice_number,
            COALESCE(gi.document_date, gi.isd_document_date, gi.boe_date) as gstr_invoice_date,
            COALESCE(gi.document_value, gi.taxable_value, (COALESCE(gi.igst,0)+COALESCE(gi.cgst,0)+COALESCE(gi.sgst,0)+COALESCE(gi.cess,0))) as gstr_invoice_total,
            gi.taxable_value as gstr_taxable,
            COALESCE(gi.total_tax, COALESCE(gi.igst, 0) + COALESCE(gi.cgst, 0) + COALESCE(gi.sgst, 0) + COALESCE(gi.cess, 0)) as gstr2b_tax,
            gi.igst as gstr_igst,
            gi.cgst as gstr_cgst,
            gi.sgst as gstr_sgst,
            gi.cess as gstr_cess,
            gi.source_section as gstr_source_section
            
        FROM reconciliation_results rr
        LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
        LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
        WHERE gi.document_number_clean = '5532763396'
    `);
    console.log(JSON.stringify(full.rows, null, 2));

    // Step 3: Check what run the frontend is using
    console.log('\n=== STEP 3: What run IDs exist? ===');
    const runs = await client.query(`SELECT id, run_type, created_at FROM reconciliation_runs ORDER BY created_at DESC`);
    console.log(JSON.stringify(runs.rows, null, 2));

    // Step 4: Sample a few records to see if ALL records have blank GSTR data
    console.log('\n=== STEP 4: Sample 5 records from latest run ===');
    const latestRun = runs.rows[0]?.id;
    if (latestRun) {
        const sample = await client.query(`
            SELECT 
                rr.id, rr.match_status,
                gi.document_number_clean as gstr_inv_no,
                gi.document_date as gstr_inv_date,
                gi.document_value as gstr_inv_value,
                gi.taxable_value as gstr_taxable,
                gi.total_tax as gstr_tax,
                pi.supplier_invoice_no as book_inv_no,
                pi.net_amount as book_total
            FROM reconciliation_results rr
            LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
            LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
            WHERE rr.recon_run_id = $1
            ORDER BY rr.id 
            LIMIT 5
        `, [latestRun]);
        console.log(JSON.stringify(sample.rows, null, 2));
    }

    await client.end();
    console.log('\n=== DEBUG COMPLETE ===');
}

debug().catch(console.error);
