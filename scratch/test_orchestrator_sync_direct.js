const { pullPurchaseData } = require('../services/workspace-service/src/connectors/adeskSyncController');
const { Client } = require('pg');
require('dotenv').config();

const workspaceId = 'a0fbb739-7ce5-473b-943b-a6c5ec782af1';

async function testDirectOrchestratorCall() {
    console.log('🚀 Triggering manual sync orchestrator directly in Node...');

    const req = {
        body: {
            workspace_id: workspaceId,
            year: '2025-26',
            quarter: 'Q1',
            month: 'April'
        }
    };

    const res = {
        statusCode: 200,
        body: null,
        status: function(code) {
            this.statusCode = code;
            return this;
        },
        json: function(data) {
            this.body = data;
            return this;
        }
    };

    try {
        await pullPurchaseData(req, res);

        console.log('Orchestrator Result Status:', res.statusCode);
        console.log('Orchestrator Result Body:', JSON.stringify(res.body, null, 2));

        // Connect to PostgreSQL database to verify ingestion
        console.log('\n🔍 Verifying database rows...');
        const client = new Client({
            host: '127.0.0.1',
            port: 5435,
            user: 'gstadmin',
            password: 'GstAdmin123',
            database: 'gst_recon'
        });

        await client.connect();
        const dbRes = await client.query('SELECT id, book_vchr_no, supplier_name, gstr_category, net_amount FROM purchase_vouchers;');

        console.log('--------------------------------------------------');
        console.log(`Database Count: ${dbRes.rowCount} row(s) found.`);
        dbRes.rows.forEach(row => {
            console.log(`Row: ID=${row.id} Voucher=${row.book_vchr_no} Supplier=${row.supplier_name} Cat=${row.gstr_category} Net=${row.net_amount}`);
        });
        console.log('--------------------------------------------------');
        
        await client.end();
    } catch (err) {
        console.error('Test execution failed:', err);
    }
}

testDirectOrchestratorCall();
