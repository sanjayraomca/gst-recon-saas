const http = require('http');

async function testErpPushUnauthorized() {
    console.log('🚀 Triggering a deliberate unauthorized book-import payload (Invalid/Inactive API Key)...');

    const postData = JSON.stringify({
        type: 'purchase_register',
        return_period: '042025',
        records: [{ vchr_no: 'PA-TEST-123' }]
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3002,
        path: '/connectors/book-import',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-API-Key': 'completely_invalid_key_999'
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

testErpPushUnauthorized();
