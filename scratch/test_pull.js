require('dotenv').config({ path: '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/.env' });

// Remap environment variables for host execution
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = 'gstadmin';
process.env.DB_PASSWORD = 'GstAdmin123';
process.env.DB_NAME = 'gst_recon';

const knex = require('../services/workspace-service/src/../../shared/src/db/connection');
const { pullPurchaseData } = require('../services/workspace-service/src/connectors/adeskSyncController');

const req = {
    body: {
        workspace_id: 'a0fbb739-7ce5-473b-943b-a6c5ec782af1',
        year: '2025-26',
        quarter: 'Q1',
        month: '4' // April 2025 (contains our FUEL & PETROL expense!)
    }
};

const res = {
    status: (code) => {
        console.log('HTTP Status Code:', code);
        return res;
    },
    json: (data) => {
        console.log('JSON Response:', JSON.stringify(data, null, 2));
        return res;
    }
};

async function main() {
    console.log('🚀 Triggering programmatic manual pull sync for A1BrainINFOTECH...');
    try {
        await pullPurchaseData(req, res);
    } catch (err) {
        console.error('Test execution failed:', err);
    } finally {
        await knex.destroy();
    }
}

main();
