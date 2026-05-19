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
      COALESCE(tp.period_code, gi.return_period, pi.return_period) as period,
      COUNT(DISTINCT pi.id) as book_count,
      SUM(pi.taxable_total) as book_taxable,
      COUNT(DISTINCT gi.id) as portal_count,
      SUM(gi.taxable_value) as portal_taxable
    FROM reconciliation_results rr
    LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
    LEFT JOIN tax_periods tp ON pi.tax_period_id = tp.id
    LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
    WHERE rr.workspace_id = $1 AND (
      tp.period_code = '042025' OR 
      gi.return_period = '042025' OR 
      pi.return_period = '042025'
    )
    GROUP BY period
  `, [workspaceId]);

  console.log('\n--- Updated Summary Group ---');
  console.log(res.rows);

  await client.end();
}

test().catch(console.error);
