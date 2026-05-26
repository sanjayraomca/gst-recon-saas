const http = require('http');
require('dotenv').config();

const apiKey = 'NmRhNDg3ZWEtM2QyNi00ZDQ5LTgwOGItODZlYmY3ZTMxNWIwQEBhMGZiYjczOS03Y2U1LTQ3M2ItOTQzYi1hNmM1ZWM3ODJhZjFAQDI0QUFMRkE5Nzg5SzFaTw==';

async function testErpPushFailure() {
    console.log('🚀 Triggering a deliberate book-import FAILURE payload (empty records array)...');

    const postData = JSON.stringify({
        type: 'purchase_register',
        return_period: '042025',
        records: [] // Empty array to trigger early validation return
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

        res.on('end', () => {
            console.log('Response Body:', body);
        });
    });

    req.on('error', (e) => {
        console.error(`Request error: ${e.message}`);
    });

    req.write(postData);
    req.end();
}

testErpPushFailure();
