const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Inject host-specific mappings for direct process run (Postgres main container port 5435)
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';

const { pullPurchaseData } = require('../src/connectors/adeskSyncController');

async function testPull(bookType = 'purchase') {
    console.log(`\n=== Testing pullPurchaseData for Book Type: ${bookType} ===`);
    const req = {
        body: {
            workspace_id: '276e51ab-12da-404a-bac9-be1d675ca0d3',
            year: '2025-2026',
            quarter: 'Q4',
            month: 'all',
            book_type: bookType
        },
        user: {
            db_id: 'ed89a2a7-c71d-42cf-92cc-eafbcaa9242b',
            name: 'asif sarani',
            email: 'sarani@gmail.com'
        }
    };

    let responseStatus = 200;
    let responseData = null;

    const res = {
        status: (code) => {
            responseStatus = code;
            return res;
        },
        json: (data) => {
            responseData = data;
            return res;
        }
    };

    try {
        await pullPurchaseData(req, res);
        console.log("Response Status:", responseStatus);
        console.log("Response Data:", JSON.stringify(responseData, null, 2));
    } catch (err) {
        console.error("Error during execution:", err);
    }
}

async function run() {
    await testPull('purchase');
    await testPull('sales');
    process.exit(0);
}

run();
