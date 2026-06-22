const { Client } = require('pg');

async function migrate() {
  const client = new Client({
    user: 'gstadmin',
    password: 'GstAdmin123',
    host: 'localhost',
    port: 5435,
    database: 'gst_recon'
  });

  await client.connect();
  console.log('Connected to database.');

  // Check if platform column exists
  const checkRes = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='purchase_items' AND column_name='platform'
  `);

  if (checkRes.rows.length === 0) {
    console.log('Adding platform column to purchase_items...');
    await client.query(`
      ALTER TABLE purchase_items 
      ADD COLUMN platform VARCHAR(100) DEFAULT 'Adesk GST'
    `);
    console.log('Platform column added successfully.');
  } else {
    console.log('Platform column already exists.');
  }

  await client.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
