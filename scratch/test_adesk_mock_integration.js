const http = require('http');
const { Client } = require('pg');
require('dotenv').config();

// Configs
const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    user: 'gstadmin',
    password: 'GstAdmin123',
    database: 'gst_recon'
};

async function runMockAdeskIntegrationTest() {
    console.log('🚀 Running Mock Adesk Ingestion Integration Test with non-UUID codes...');

    const client = new Client(dbConfig);
    await client.connect();

    try {
        // 1. Get a workspace
        const wsRes = await client.query('SELECT id, tenant_id, gstn, name FROM workspaces LIMIT 1;');
        if (wsRes.rowCount === 0) {
            throw new Error('No workspace found in database');
        }
        const workspace = wsRes.rows[0];
        console.log(`🏢 Test Workspace: "${workspace.name}" (ID: ${workspace.id})`);

        // 2. Insert/Seed an Adesk key into workspace_api_keys with custom project/org codes
        const projectCode = 'proj_code_test_999';
        const orgCode = 'org_code_test_999';
        const adeskKeyRaw = `${projectCode}@@${orgCode}@@${workspace.gstn}`;
        const adeskKeyBase64 = Buffer.from(adeskKeyRaw).toString('base64');

        await client.query('DELETE FROM workspace_api_keys WHERE workspace_id = $1;', [workspace.id]);
        await client.query(`
            INSERT INTO workspace_api_keys (
                workspace_id, tenant_id, production_key, sandbox_key, status, mode, third_party_name, extrainfo, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW());
        `, [
            workspace.id,
            workspace.tenant_id,
            adeskKeyBase64,
            Buffer.from(`${projectCode}@@${orgCode}@@${workspace.gstn}_sandbox`).toString('base64'),
            'active',
            'live',
            'Adesk Cloud',
            JSON.stringify({ project_code: projectCode, org_code: orgCode })
        ]);

        console.log(`✅ Seeded Adesk key "${adeskKeyRaw}" in database.`);

        // 3. Make HTTP request to mock-adesk server
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
                'x-api-key': adeskKeyBase64,
                'Authorization': `Bearer adsk_token_a0fbb739` // dummy header
            }
        };

        console.log('Sending request to /connectors/mock-adesk...');
        const req = http.request(options, (res) => {
            let body = '';
            console.log(`Response Status Code: ${res.statusCode}`);

            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', async () => {
                console.log('Response Body:', body);
                
                // 4. Verify in DB if vouchers were ingested
                const dbRes = await client.query('SELECT count(*) FROM purchase_vouchers WHERE workspace_id = $1;', [workspace.id]);
                console.log(`📊 Ingested vouchers count in database: ${dbRes.rows[0].count}`);
                
                // Cleanup
                await client.query('DELETE FROM workspace_api_keys WHERE workspace_id = $1;', [workspace.id]);
                console.log('🧹 Cleaned up temporary API keys.');
                await client.end();
            });
        });

        req.on('error', (e) => {
            console.error(`Request error: ${e.message}`);
            client.end();
        });

        req.write(postData);
        req.end();

    } catch (err) {
        console.error('❌ Integration Test failed:', err);
        await client.end();
    }
}

runMockAdeskIntegrationTest();
