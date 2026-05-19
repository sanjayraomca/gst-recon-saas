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

  console.log('--- Updating EXP37 tax_period_id to 042025 ---');
  const updateRes = await client.query(`
    UPDATE purchase_vouchers 
    SET tax_period_id = 'dbe19ae7-cdb6-4b9d-8ac9-89d3f03d07ba' 
    WHERE book_vchr_no = 'EXP37'
  `);
  console.log(`Updated rows count: ${updateRes.rowCount}`);

  await client.end();
}

test().catch(console.error);
