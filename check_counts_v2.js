const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkCounts() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        const tables = [
            'purchase_vouchers',
            'normalized_gstr2b_invoices',
            'reconciliation_results',
            'reconciliation_runs'
        ];

        for (const table of tables) {
            const res = await client.query(`SELECT COUNT(*) FROM ${table}`);
            console.log(`${table}: ${res.rows[0].count}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkCounts();
