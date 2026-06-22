const { Client } = require('pg');

async function test() {
  const client = new Client({
    user: 'gstadmin',
    password: 'GstAdmin123',
    host: 'localhost',
    port: 5435,
    database: 'gst_recon'
  });

  await client.connect();

  // Let's get active workspaces
  const wsRes = await client.query("SELECT id, name FROM workspaces");
  console.log('Workspaces:', wsRes.rows);
  const workspaceId = wsRes.rows[0]?.id;

  // Let's get reconciliation runs
  const runRes = await client.query("SELECT id, run_type, status, created_at FROM reconciliation_runs");
  console.log('\nRuns:', runRes.rows);

  // Let's list details from reconciliation_results left joining purchase_vouchers and normalized_gstr2b_invoices where return_period or period_code is '042025'
  const reconRes = await client.query(`
    SELECT 
      rr.id,
      rr.match_status,
      pi.book_vchr_no,
      pi.supplier_invoice_no as book_inv_no,
      pi.supplier_name as book_supplier_name,
      pi.taxable_total as book_taxable,
      gi.document_number_raw as portal_inv_no,
      gi.supplier_name as portal_supplier_name,
      gi.taxable_value as portal_taxable,
      COALESCE(tp.period_code, gi.return_period) as resolved_period
    FROM reconciliation_results rr
    LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
    LEFT JOIN tax_periods tp ON pi.tax_period_id = tp.id
    LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
    WHERE rr.workspace_id = $1 AND (tp.period_code = '042025' OR gi.return_period = '042025')
  `, [workspaceId]);

  console.log(`\n--- Mapped Reconciliation Results for 042025 (Count: ${reconRes.rows.length}) ---`);
  reconRes.rows.forEach((r, i) => {
    console.log(`${i+1}. [${r.match_status}] ` +
      `Book: [No: ${r.book_vchr_no || 'N/A'}, Inv: ${r.book_inv_no || 'N/A'}, Supplier: ${r.book_supplier_name || 'N/A'}, Taxable: ${r.book_taxable || 0}] <-> ` +
      `Portal: [Inv: ${r.portal_inv_no || 'N/A'}, Supplier: ${r.portal_supplier_name || 'N/A'}, Taxable: ${r.portal_taxable || 0}]`);
  });

  await client.end();
}

test().catch(console.error);
