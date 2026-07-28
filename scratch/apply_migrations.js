const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

async function main() {
    const migrationsDir = path.join(__dirname, '../infra/postgres/migrations');
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    console.log(`Found ${files.length} migration file(s).`);

    const client = new Client(dbConfig);
    await client.connect();

    try {
        for (const file of files) {
            console.log(`Applying migration: ${file}...`);
            const sqlPath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await client.query(sql);
            console.log(`✅ Migration ${file} applied successfully.`);
        }
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        await client.end();
    }
}

main();
