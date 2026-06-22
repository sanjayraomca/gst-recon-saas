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

  console.log('--- Current status of EXP37 ---');
  const checkBefore = await client.query("SELECT id, book_vchr_no, return_period, taxable_total FROM purchase_vouchers WHERE book_vchr_no = 'EXP37'");
  console.log(checkBefore.rows);

  console.log('--- Updating EXP37 return_period to 042025 ---');
  const updateRes = await client.query("UPDATE purchase_vouchers SET return_period = '042025' WHERE book_vchr_no = 'EXP37'");
  console.log(`Updated rows count: ${updateRes.rowCount}`);

  console.log('--- Verifying after update ---');
  const checkAfter = await client.query("SELECT id, book_vchr_no, return_period, taxable_total FROM purchase_vouchers WHERE book_vchr_no = 'EXP37'");
  console.log(checkAfter.rows);

  await client.end();
}

test().catch(console.error);
