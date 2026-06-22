const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Map variables if they don't match knexfile expectations
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_USER = process.env.DB_USER || process.env.POSTGRES_MAIN_USER;
process.env.DB_PASSWORD = process.env.DB_PASSWORD || process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_NAME = process.env.DB_NAME || process.env.POSTGRES_MAIN_DB;

const knex = require('./services/shared/src/db/connection');

async function checkLogs() {
    try {
        const logs = await knex('activity_logs')
            .orderBy('created_at', 'desc')
            .limit(10);
        
        console.log('Recent Activity Logs:');
        logs.forEach(log => {
            console.log(`[${log.created_at.toISOString()}] ${log.action_type} - User: ${log.user_id}, Tenant: ${log.tenant_id}, Entity: ${log.entity_id}`);
        });
        process.exit(0);
    } catch (err) {
        console.error('Error checking logs:', err.message);
        process.exit(1);
    }
}

checkLogs();
