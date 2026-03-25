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
        
        console.log('--- Listing Tables ---');
        const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables:', tables.rows.map(r => r.table_name));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
