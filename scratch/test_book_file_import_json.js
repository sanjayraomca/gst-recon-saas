const http = require('http');
const { Client } = require('pg');
require('dotenv').config();

async function testFileImportWithJson() {
    console.log('🚀 Triggering a JSON payload to /connectors/book-import/file using raw JSON...');

    const postData = JSON.stringify({
        type: 'purchase_register',
        return_period: '042025',
        records: [{
            vchr_no: 'ERP-JSON-FILE-111',
            vchr_date: '2025-04-18',
            supplier_name: 'DYNAMIC JSON CO',
            supplier_gstin: '24DGLPP8130C1ZH',
            taxable_value: 3000,
            igst: 0,
            cgst: 270,
            sgst: 270,
            total_value: 3540
        }]
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3002,
        path: '/connectors/book-import/file',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-API-Key': 'NmRhNDg3ZWEtM2QyNi00ZDQ5LTgwOGItODZlYmY3ZTMxNWIwQEBhMGZiYjczOS03Y2U1LTQ3M2ItOTQzYi1hNmM1ZWM3ODJhZjFAQDI0QUFMRkE5Nzg5SzFaTw=='
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
                const dbRes = await client.query("SELECT id, book_vchr_no, supplier_name, net_amount FROM purchase_vouchers WHERE book_vchr_no = 'ERP-JSON-FILE-111';");

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

testFileImportWithJson();
