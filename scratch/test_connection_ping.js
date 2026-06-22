const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Map host DB variables for local execution
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';

const { testConnection } = require('../services/workspace-service/src/connectors/adeskSyncController');

async function testConnectionCheck() {
    console.log('🚀 Triggering manual sync connection ping check in Node...');

    const req = {
        body: {
            workspace_id: 'a0fbb739-7ce5-473b-943b-a6c5ec782af1',
            cloudUrl: 'http://localhost:3002/connectors/mock-adesk',
            apiToken: 'adsk_token_a0fbb739'
        }
    };

    const res = {
        statusCode: 200,
        body: null,
        status: function (code) {
            this.statusCode = code;
            return this;
        },
        json: function (data) {
            this.body = data;
            return this;
        }
    };

    try {
        await testConnection(req, res);

        console.log('Connection Check Status:', res.statusCode);
        console.log('Connection Check Body:', JSON.stringify(res.body, null, 2));
    } catch (err) {
        console.error('Test execution failed:', err);
    }
}

testConnectionCheck();
