require('dotenv').config();
process.env.DB_HOST = 'localhost';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';
process.env.DB_PORT = 5435;

const knex = require('../services/shared/src/db/connection');

async function checkData() {
    try {
        const data = await knex('workspace_users').select('id', 'user_id', 'workspace_id', 'role', 'permissions').limit(5);
        console.log('workspace_users data:', JSON.stringify(data, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkData();
