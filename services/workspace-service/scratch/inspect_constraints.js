const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function run() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Unique Constraints & Indexes of sales_invoices ---');
        const res = await client.query(`
            SELECT conname, pg_get_constraintdef(c.oid) 
            FROM pg_constraint c 
            JOIN pg_namespace n ON n.oid = c.connamespace 
            WHERE conrelid = 'sales_invoices'::regclass
        `);
        console.table(res.rows);

        console.log('--- Indexes of sales_invoices ---');
        const indexRes = await client.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'sales_invoices'
        `);
        console.table(indexRes.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
