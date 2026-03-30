const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkWorkspaceId() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Workspace ID in reconciliation_results ---');
        const res = await client.query(`
            SELECT workspace_id, COUNT(*) as count
            FROM reconciliation_results
            GROUP BY workspace_id
        `);
        console.table(res.rows);

        console.log('\n--- Workspaces available ---');
        const workspaces = await client.query(`
            SELECT id, organization_name, gstin
            FROM workspaces
        `);
        console.table(workspaces.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkWorkspaceId();
