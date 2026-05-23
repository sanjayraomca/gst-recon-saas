const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/.env' });

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

async function main() {
    console.log('Applying migration: 001_add_book_api_connector_tables.sql...');
    const client = new Client(dbConfig);
    await client.connect();

    try {
        const sqlPath = path.join(__dirname, '../infra/postgres/migrations/001_add_book_api_connector_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await client.query(sql);
        console.log('✅ Migration applied successfully.');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        await client.end();
    }
}

main();
