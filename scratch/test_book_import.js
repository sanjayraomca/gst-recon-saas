const http = require('http');
const { Client } = require('pg');
require('dotenv').config();

const apiKey = 'NmRhNDg3ZWEtM2QyNi00ZDQ5LTgwOGItODZlYmY3ZTMxNWIwQEBhMGZiYjczOS03Y2U1LTQ3M2ItOTQzYi1hNmM1ZWM3ODJhZjFAQDI0QUFMRkE5Nzg5SzFaTw=='; // Base64 key from screenshot

async function testErpPush() {
    console.log('🚀 Triggering ERP JSON push to /connectors/book-import using native HTTP...');

    const postData = JSON.stringify({
        type: 'purchase_register',
        return_period: '042025',
        records: [
            {
                vchr_no: 'ERP-PUSH-999',
                vchr_date: '2025-04-01',
                supplier_name: 'JET FUEL CO',
                supplier_gstin: '',
                taxable_value: 5000.00,
                igst: 0.00,
                cgst: 0.00,
                sgst: 0.00,
                cess: 0.00,
                total_value: 5000.00
            }
        ]
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3002,
        path: '/connectors/book-import',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-API-Key': apiKey
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
                const dbRes = await client.query("SELECT id, book_vchr_no, supplier_name, gstr_category, net_amount FROM purchase_vouchers WHERE book_vchr_no = 'ERP-PUSH-999';");

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

testErpPush();
