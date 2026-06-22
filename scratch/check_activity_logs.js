const { Client } = require('pg');

async function checkLogs() {
    const client = new Client({
        host: '127.0.0.1',
        port: 5435,
        user: 'gstadmin',
        password: 'GstAdmin123',
        database: 'gst_recon'
    });

    try {
        await client.connect();
        
        // Truncate logs if requested as command argument
        if (process.argv.includes('--clear')) {
            await client.query("TRUNCATE TABLE activity_logs CASCADE;");
            console.log('🧹 Truncated activity_logs successfully.');
            return;
        }

        const dbRes = await client.query("SELECT id, tenant_id, workspace_id, action_type, entity_type, details, created_at FROM activity_logs ORDER BY created_at DESC LIMIT 10;");

        console.log('\n📊 Recent Activity Logs:');
        console.log('================================================================================');
        if (dbRes.rowCount === 0) {
            console.log('No activity logs found.');
        } else {
            dbRes.rows.forEach((row, index) => {
                console.log(`[#${index + 1}] ID: ${row.id}`);
                console.log(`     Action: ${row.action_type} | Entity: ${row.entity_type}`);
                console.log(`     Workspace: ${row.workspace_id} | Tenant: ${row.tenant_id}`);
                console.log(`     Details: ${JSON.stringify(row.details)}`);
                console.log(`     Created At: ${row.created_at}`);
                console.log('--------------------------------------------------------------------------------');
            });
        }
    } catch (err) {
        console.error('Database connection error:', err.message);
    } finally {
        await client.end();
    }
}

checkLogs();
