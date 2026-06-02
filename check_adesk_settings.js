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
        
        console.log('--- Workspace & Adesk Settings ---');
        const res = await client.query(`
            SELECT id, name, gstn, settings
            FROM workspaces
        `);
        for (const row of res.rows) {
            console.log(`Workspace: ${row.name} (ID: ${row.id}, GSTIN: ${row.gstn})`);
            console.log('Settings:', row.settings);
            console.log('----------------------------------------------------');
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
