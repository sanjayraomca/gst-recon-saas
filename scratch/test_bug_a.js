const fetch = require('cross-fetch');
const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    user: 'gstadmin',
    password: 'GstAdmin123',
    database: 'gst_recon'
};

const TENANT_SERVICE_URL = 'http://localhost:3001';

async function runTest() {
    const timestamp = Date.now();
    const adminEmail = `audit_admin_a_${timestamp}@example.com`;
    const password = 'Password123';

    console.log(`\n==================================================`);
    console.log(`🚀 SETUP: Creating User and Seeding 'SYSTEM' Audit Log...`);
    console.log(`==================================================`);

    // 1. Register Tenant Admin
    const signupRes = await fetch(`${TENANT_SERVICE_URL}/tenants/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: adminEmail,
            password: password,
            full_name: 'Audit Bug A User',
            phone: '9999999999'
        })
    });
    const signupData = await signupRes.json();
    if (!signupRes.ok) {
        console.error('❌ Admin Register Failed:', signupData);
        process.exit(1);
    }
    console.log(`✅ Admin user registered: ${adminEmail}`);

    // 2. Login Admin
    const loginRes = await fetch(`${TENANT_SERVICE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: password })
    });
    const loginData = await loginRes.json();
    const token = loginData.data.access_token;
    console.log(`✅ Admin logged in.`);

    // 3. Seed Audit Log with 'SYSTEM'
    const pgClient = new Client(dbConfig);
    await pgClient.connect();

    await pgClient.query(`
        INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, modified_by)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, ['workspaces', require('crypto').randomUUID(), 'UPDATE', '{}', '{}', 'SYSTEM']);
    console.log(`✅ Seeded audit_log entry with modified_by = 'SYSTEM'.`);
    await pgClient.end();

    // 4. Request /tenants/audit-logs
    console.log(`\n--------------------------------------------------`);
    console.log(`Requesting GET ${TENANT_SERVICE_URL}/tenants/audit-logs...`);
    const res = await fetch(`${TENANT_SERVICE_URL}/tenants/audit-logs`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    const data = await res.json();
    console.log(`Status Code: ${res.status}`);
    console.log(`Response Body:`, JSON.stringify(data));

    if (res.status === 200) {
        console.log(`\n✅ TEST PASSED: Endpoint returned successfully.`);
    } else {
        console.log(`\n❌ TEST FAILED: Endpoint crashed or returned error.`);
    }
}

runTest().catch(err => {
    console.error('Fatal Test Run Error:', err);
    process.exit(1);
});
