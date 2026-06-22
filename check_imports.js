const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: (process.env.DB_HOST === 'postgres-main' ? '127.0.0.1' : process.env.DB_HOST) || '127.0.0.1',
    port: process.env.DB_PORT || 5435,
    database: process.env.DB_NAME || 'gst_recon',
    user: process.env.DB_USER || 'gstadmin',
    password: process.env.DB_PASSWORD || 'GstAdmin123',
};

async function checkImports() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        const res = await client.query('SELECT import_type, return_period, upload_timestamp, status FROM gstr_import_master ORDER BY upload_timestamp DESC LIMIT 20');
        console.log(JSON.stringify(res.rows));
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
checkImports();
