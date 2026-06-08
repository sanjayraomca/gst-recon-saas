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
    SELECT id, invoice_number, platform 
    FROM sales_invoices 
    LIMIT 20
  `);
  console.log('Sample sales_invoices rows:');
  console.log(res.rows);

  const dist = await client.query(`
    SELECT DISTINCT platform, COUNT(*)
    FROM sales_invoices
    GROUP BY platform
  `);
  console.log('Platform distribution in sales_invoices:');
  console.log(dist.rows);

  await client.end();
}

check().catch(console.error);
