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
  
  const pvCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='purchase_vouchers'");
  console.log('purchase_vouchers columns:', pvCols.rows.map(r => `${r.column_name} (${r.data_type})`));

  const g2bCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='normalized_gstr2b_invoices'");
  console.log('normalized_gstr2b_invoices columns:', g2bCols.rows.map(r => `${r.column_name} (${r.data_type})`));

  await client.end();
}

test().catch(console.error);
