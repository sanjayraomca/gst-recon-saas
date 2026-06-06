const knex = require('../services/workspace-service/node_modules/knex')({
    client: 'pg',
    connection: {
        host: process.env.POSTGRES_MAIN_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_MAIN_PORT || '5435', 10),
        user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
        password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
        database: process.env.POSTGRES_MAIN_DB || 'gst_recon'
    }
});

async function run() {
    try {
        const workspaceId = '0e87ab31-a7aa-4252-b2c9-ace3a65bc3bb';
        console.log('Testing Knex connection and query for workspace:', workspaceId);

        let query = knex('deleted_invoices').where('workspace_id', workspaceId);
        const countResult = await query.clone().count('id as count').first();
        console.log('Count Result:', countResult);

        const rows = await query.select('*');
        console.log('Rows found:', rows.length);
        for (const row of rows) {
            console.log(`- ID: ${row.id}, Type: ${row.type}, Subtype: ${row.subtype}, Vchr: ${row.vchr_no}, Remark: ${row.remark}`);
        }
    } catch (err) {
        console.error('Error running test query:', err);
    } finally {
        await knex.destroy();
    }
}

run();
