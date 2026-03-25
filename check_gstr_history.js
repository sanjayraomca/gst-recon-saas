const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function check() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Checking GSTR Import Master ---');
        const res = await client.query('SELECT import_filing_id, workspace_id, status, import_type, return_period, total_record FROM gstr_import_master ORDER BY upload_timestamp DESC LIMIT 10');
        console.log('History:', res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
