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

        const res = await client.query(`
            SELECT id, supplier_invoice_no, xmax 
            FROM purchase_vouchers 
            LIMIT 5
        `);
        console.table(res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
