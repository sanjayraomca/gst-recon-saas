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
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public'
  `);
  console.log('Tables:', res.rows.map(r => r.table_name));
  await client.end();
}

test().catch(console.error);
