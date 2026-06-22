const http = require('http');
const { Client } = require('pg');
require('dotenv').config();

const workspaceId = 'a0fbb739-7ce5-473b-943b-a6c5ec782af1';

async function testOrchestratorSync() {
    console.log('🚀 Triggering manual sync orchestrator using native HTTP...');

    const postData = JSON.stringify({
        workspace_id: workspaceId,
        year: '2025-26',
        quarter: 'Q1',
        month: '04'
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3002,
        path: '/connectors/adesk/pull-purchase',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        console.log(`Status Code: ${res.statusCode}`);

        res.on('data', (chunk) => {
            body += chunk;
        });

        res.on('end', async () => {
            console.log('Response Body:', body);

            // Connect to PostgreSQL database to verify ingestion
            console.log('\n🔍 Verifying database rows...');
            const client = new Client({
                host: '127.0.0.1',
                port: 5435,
                user: 'gstadmin',
                password: 'GstAdmin123',
                database: 'gst_recon'
            });

            try {
                await client.connect();
                const dbRes = await client.query('SELECT id, book_vchr_no, supplier_name, gstr_category, net_amount FROM purchase_vouchers;');

                console.log('--------------------------------------------------');
                console.log(`Database Count: ${dbRes.rowCount} row(s) found.`);
                dbRes.rows.forEach(row => {
                    console.log(`Row: ID=${row.id} Voucher=${row.book_vchr_no} Supplier=${row.supplier_name} Cat=${row.gstr_category} Net=${row.net_amount}`);
                });
                console.log('--------------------------------------------------');
            } catch (dbErr) {
                console.error('Database connection error:', dbErr.message);
            } finally {
                await client.end();
            }
        });
    });

    req.on('error', (e) => {
        console.error(`Request error: ${e.message}`);
    });

    req.write(postData);
    req.end();
}

testOrchestratorSync();
