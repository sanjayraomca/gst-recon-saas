const { Client } = require('pg');

async function check() {
  const client = new Client({
    user: 'gstadmin',
    password: 'GstAdmin123',
    host: 'localhost',
    port: 5435,
    database: 'gst_recon'
  });

  await client.connect();
  console.log('Connected to database.');

  const res = await client.query(`
    SELECT id, purchase_id, platform, description 
    FROM purchase_items 
    LIMIT 10
  `);
  console.log('Sample purchase_items rows:');
  console.log(res.rows);

  await client.end();
}

check().catch(console.error);
