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
        
        console.log('--- CHECK CONSTRAINTS for sales_invoices ---');
        const res = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) as def
            FROM pg_constraint
            WHERE conrelid = 'sales_invoices'::regclass AND contype = 'c';
        `);
        console.table(res.rows);

        console.log('\n--- CHECK CONSTRAINTS for purchase_vouchers ---');
        const res2 = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) as def
            FROM pg_constraint
            WHERE conrelid = 'purchase_vouchers'::regclass AND contype = 'c';
        `);
        console.table(res2.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
