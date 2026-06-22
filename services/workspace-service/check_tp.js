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

  const tpRes = await client.query("SELECT id, period_code FROM tax_periods WHERE period_code = '042025' OR period_code = '202504'");
  console.log('Tax periods found:', tpRes.rows);

  await client.end();
}

test().catch(console.error);
