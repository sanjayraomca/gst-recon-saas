const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkRunIds() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Run ID distribution in reconciliation_results ---');
        const res = await client.query(`
            SELECT recon_run_id, COUNT(*) as count
            FROM reconciliation_results
            GROUP BY recon_run_id
        `);
        console.table(res.rows);

        console.log('\n--- Latest 5 Reconciliation Runs ---');
        const runs = await client.query(`
            SELECT id, period, run_mode, status, created_at
            FROM reconciliation_runs
            ORDER BY created_at DESC
            LIMIT 5
        `);
        console.table(runs.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkRunIds();
