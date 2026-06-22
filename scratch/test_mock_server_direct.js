const http = require('http');
const { Client } = require('pg');
require('dotenv').config();

const tenantId = 'e305dd8d-4ca0-410a-9d62-c0e816a75f1a'; // Legacy bad tenant ID
const workspaceId = 'a0fbb739-7ce5-473b-943b-a6c5ec782af1';
const gstin = '24AALFA9789K1ZO';
const apiToken = 'adsk_token_a0fbb739';

// Encode API key matching structural format
const rawKey = `${tenantId}@@${workspaceId}@@${gstin}`;
const encodedKey = Buffer.from(rawKey).toString('base64');

async function testDirectMockIngestion() {
    console.log('🚀 Triggering direct mock server query using native HTTP...');

    const postData = JSON.stringify({
        type: 'purchase',
        start_date: '2025-04-01',
        end_date: '2025-04-30'
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3002,
        path: '/connectors/mock-adesk',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'x-api-key': encodedKey,
            'Authorization': `Bearer ${apiToken}`
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
                const dbRes = await client.query('SELECT id, book_vchr_no, supplier_name, net_amount FROM purchase_vouchers;');

                console.log('--------------------------------------------------');
                console.log(`Database Count: ${dbRes.rowCount} row(s) found.`);
                dbRes.rows.forEach(row => {
                    console.log(`Row: ID=${row.id} Voucher=${row.book_vchr_no} Supplier=${row.supplier_name} Net=${row.net_amount}`);
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

testDirectMockIngestion();
