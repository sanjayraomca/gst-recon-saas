const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. Construct JWT
const header = { alg: "HS256", typ: "JWT" };
const payload = {
    email: "superadmin.dev@gmail.com",
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    sub: "test-user-id",
    realm_access: { roles: ["gst_admin"] },
    name: "Super Admin"
};

const base64Url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = `${base64Url(header)}.${base64Url(payload)}.dummy_signature`;

// 2. Prepare Upload
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const returnPeriod = '042025';
const filePath = path.join(__dirname, '../sales_register.xlsx');
const fileStats = fs.statSync(filePath);

const postDataStart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="return_period"`,
    ``,
    `${returnPeriod}`,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="sales_register.xlsx"`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
    ``,
    ``
].join('\r\n');

const postDataEnd = `\r\n--${boundary}--`;

const options = {
    hostname: '127.0.0.1',
    port: 3004,
    path: '/book-import/sales/upload',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(postDataStart) + fileStats.size + Buffer.byteLength(postDataEnd)
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
    res.on('end', () => {
        console.log('No more data in response.');
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

// Write data to request body
req.write(postDataStart);
const fileStream = fs.createReadStream(filePath);
fileStream.pipe(req, { end: false });
fileStream.on('end', () => {
    req.write(postDataEnd);
    req.end();
});
