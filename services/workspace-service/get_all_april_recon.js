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

  const wsRes = await client.query("SELECT id FROM workspaces");
  const workspaceId = wsRes.rows[0]?.id;

  const res = await client.query(`
    SELECT 
      rr.match_status,
      pi.book_vchr_no,
      pi.supplier_invoice_no as book_inv_no,
      pi.supplier_name as book_supplier_name,
      pi.taxable_total as book_taxable,
      pi.return_period as book_period,
      gi.document_number_raw as portal_inv_no,
      gi.supplier_name as portal_supplier_name,
      gi.taxable_value as portal_taxable,
      gi.return_period as portal_period,
      COALESCE(tp.period_code, gi.return_period) as resolved_period
    FROM reconciliation_results rr
    LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
    LEFT JOIN tax_periods tp ON pi.tax_period_id = tp.id
    LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
    WHERE rr.workspace_id = $1 AND (
      tp.period_code IN ('042025', '202504') OR 
      gi.return_period IN ('042025', '202504') OR 
      pi.return_period IN ('042025', '202504')
    )
    ORDER BY pi.book_vchr_no, gi.document_number_raw
  `, [workspaceId]);

  console.log(`\nAll April 2025 matched records across formats (Count: ${res.rows.length}):`);
  res.rows.forEach((r, i) => {
    console.log(`${i+1}. [${r.match_status}] ` +
      `VchrNo: ${r.book_vchr_no || 'N/A'}, BookInv: ${r.book_inv_no || 'N/A'}, BookPeriod: ${r.book_period || 'N/A'}, ` +
      `PortalInv: ${r.portal_inv_no || 'N/A'}, PortalPeriod: ${r.portal_period || 'N/A'}, ` +
      `BookTaxable: ${r.book_taxable}, PortalTaxable: ${r.portal_taxable}`);
  });

  await client.end();
}

test().catch(console.error);
