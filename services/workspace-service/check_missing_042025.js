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

  // Get workspace ID
  const wsRes = await client.query("SELECT id, name FROM workspaces");
  const workspaceId = wsRes.rows[0]?.id;

  // Let's query ALL purchase vouchers for return_period = '042025' or '202504'
  const pvList = await client.query(`
    SELECT id, book_vchr_no, supplier_invoice_no, supplier_name, taxable_total, return_period
    FROM purchase_vouchers
    WHERE workspace_id = $1 AND (return_period = '042025' OR return_period = '202504')
  `, [workspaceId]);

  console.log(`All Purchase Vouchers in DB for 042025 (Count: ${pvList.rows.length}):`);
  
  // For each purchase voucher, check if it exists in reconciliation_results
  for (const pv of pvList.rows) {
    const reconCheck = await client.query(`
      SELECT id, match_status, recon_run_id
      FROM reconciliation_results
      WHERE purchase_invoice_id = $1
    `, [pv.id]);
    
    if (reconCheck.rows.length > 0) {
      console.log(`- FOUND: Vchr: ${pv.book_vchr_no}, InvNo: ${pv.supplier_invoice_no}, Supplier: ${pv.supplier_name}, Taxable: ${pv.taxable_total} [Status: ${reconCheck.rows[0].match_status}, Run: ${reconCheck.rows[0].recon_run_id}]`);
    } else {
      console.log(`\n>>> MISSING FROM RECONCILIATION: Vchr: ${pv.book_vchr_no}, InvNo: ${pv.supplier_invoice_no}, Supplier: ${pv.supplier_name}, Taxable: ${pv.taxable_total} <<<\n`);
    }
  }

  await client.end();
}

test().catch(console.error);
