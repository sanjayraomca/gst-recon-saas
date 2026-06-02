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
        
        console.log("Connected successfully to DB!");

        // Select latest imports
        const res = await client.query("SELECT import_filing_id, workspace_id, import_type, status, original_filename, started_at FROM gstr_import_master ORDER BY started_at DESC LIMIT 5");
        console.log("Imports:", res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
