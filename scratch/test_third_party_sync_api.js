const fetch = require('cross-fetch');

async function testSyncFlow() {
    console.log('🚀 Starting Third-Party API Key & Sync Integration Tests...');

    // 1. Get user token from Keycloak
    console.log('🔑 Authenticating as superadmin...');
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', 'admin-api');
    tokenParams.append('client_secret', 'admin-api-secret-change-in-production');
    tokenParams.append('grant_type', 'password');
    tokenParams.append('username', 'superadmin.dev@gmail.com');
    tokenParams.append('password', 'superadmin@123');

    const tokenRes = await fetch('http://localhost:8080/realms/gsttool/protocol/openid-connect/token', {
        method: 'POST',
        body: tokenParams,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!tokenRes.ok) {
        throw new Error(`Failed to authenticate: ${tokenRes.status} ${await tokenRes.text()}`);
    }

    const { access_token } = await tokenRes.json();
    console.log('✅ Token obtained successfully.');

    // 2. Fetch user's workspaces
    console.log('🏢 Fetching workspaces...');
    const wsRes = await fetch('http://localhost:3002/workspaces', {
        headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!wsRes.ok) {
        throw new Error(`Failed to fetch workspaces: ${wsRes.status} ${await wsRes.text()}`);
    }

    const wsData = await wsRes.json();
    const workspace = wsData.data && wsData.data[0];
    if (!workspace) {
        throw new Error('No workspaces found for the user!');
    }

    const workspaceId = workspace.id;
    console.log(`✅ Found workspace: "${workspace.name}" (ID: ${workspaceId})`);

    // 3. Generate Third-Party API Key
    console.log('⚡ Generating third-party API key...');
    const genRes = await fetch('http://localhost:3001/auth/third-party/generate-api-key', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + access_token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            workspace_id: workspaceId,
            key_name: 'Test Tally Key',
            platform: 'Tally Prime'
        })
    });

    if (!genRes.ok) {
        throw new Error(`Failed to generate API Key: ${genRes.status} ${await genRes.text()}`);
    }

    const genData = await genRes.json();
    const apiKey = genData.data.api_key;
    const apiKeyId = genData.data.id;
    console.log(`✅ Generated API Key: ${apiKey} (ID: ${apiKeyId})`);

    // 4. Test Inbound Sync API on Port 3002 with the new API Key
    console.log('🔄 Calling sync endpoint with the new API Key...');
    const syncRes = await fetch('http://localhost:3002/purchase-invoices/third-party/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify([
            {
                book_vchr_no: 'TEST-VCHR-999',
                supplier_invoice_no: 'TEST-INV-999',
                supplier_invoice_date: '2026-06-01',
                supplier_name: 'Test Supplier Ltd',
                supplier_gstin: '27AAAAA1111A1Z1',
                taxable_value: 10000,
                cgst: 900,
                sgst: 900,
                igst: 0,
                total_value: 11800
            }
        ])
    });

    if (!syncRes.ok) {
        throw new Error(`Sync failed: ${syncRes.status} ${await syncRes.text()}`);
    }

    const syncResult = await syncRes.json();
    console.log('✅ Sync response:', syncResult);

    // 5. Revoke the API Key
    console.log('🗑️ Revoking API key...');
    const revokeRes = await fetch(`http://localhost:3001/auth/third-party/api-keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!revokeRes.ok) {
        throw new Error(`Revocation failed: ${revokeRes.status} ${await revokeRes.text()}`);
    }

    console.log('✅ API Key revoked.');

    // 6. Verify revoked key returns 401
    console.log('🔒 Verifying sync with revoked key fails...');
    const revokedSyncRes = await fetch('http://localhost:3002/purchase-invoices/third-party/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify([])
    });

    console.log(`Status code: ${revokedSyncRes.status}`);
    const revokedText = await revokedSyncRes.text();
    console.log(`Response body: ${revokedText}`);

    if (revokedSyncRes.status === 401) {
        console.log('✅ Verification success: Sync was blocked with 401.');
    } else {
        throw new Error('Sync was NOT blocked with 401!');
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

testSyncFlow().catch(err => {
    console.error('❌ Test flow failed:', err.message);
    process.exit(1);
});
