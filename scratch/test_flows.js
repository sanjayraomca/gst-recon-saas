const fetch = require('cross-fetch');

const TENANT_SERVICE_URL = 'http://localhost:3001';
const WORKSPACE_SERVICE_URL = 'http://localhost:3002';

async function runTests() {
    const timestamp = Date.now();
    const testEmail = `testuser_${timestamp}@example.com`;
    const testPassword = 'Password123';
    const testName = 'Dev Test User';

    console.log(`\n--- STEP 1: Register New Tenant Admin User ---`);
    console.log(`Registering with Email: ${testEmail}`);
    
    let signupRes;
    try {
        signupRes = await fetch(`${TENANT_SERVICE_URL}/tenants/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword,
                full_name: testName,
                phone: '9876543210'
            })
        });
    } catch (err) {
        console.error(`❌ Register POST Request Failed:`, err.message);
        process.exit(1);
    }

    const signupData = await signupRes.json();
    if (!signupRes.ok) {
        console.error(`❌ Register Response Failed:`, signupData);
        process.exit(1);
    }
    console.log(`✅ User registered successfully. keycloakId: ${signupData.data.keycloakId || signupData.data.user?.auth_provider_id}`);

    console.log(`\n--- STEP 2: Authenticate and Obtain JWT Token ---`);
    let loginRes;
    try {
        loginRes = await fetch(`${TENANT_SERVICE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword
            })
        });
    } catch (err) {
        console.error(`❌ Login POST Request Failed:`, err.message);
        process.exit(1);
    }

    const loginData = await loginRes.json();
    if (!loginRes.ok) {
        console.error(`❌ Login Response Failed:`, loginData);
        process.exit(1);
    }
    
    const token = loginData.data.access_token;
    const tenantId = loginData.data.tenant_id;
    console.log(`✅ Login successful. Tenant ID: ${tenantId}`);
    console.log(`Token acquired: ${token.substring(0, 30)}...`);

    console.log(`\n--- STEP 3: Create Workspace Organization ---`);
    let createWsRes;
    try {
        createWsRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'x-tenant-id': tenantId
            },
            body: JSON.stringify({
                code: '29AABCD1234E1ZF',
                name: `E2E Workspace ${timestamp}`,
                type: 'COMPANY',
                filing_frequency: 'monthly',
                state: '29-Karnataka',
                city: 'Bengaluru',
                email: testEmail
            })
        });
    } catch (err) {
        console.error(`❌ Create Workspace POST Request Failed:`, err.message);
        process.exit(1);
    }

    const createWsData = await createWsRes.json();
    if (!createWsRes.ok) {
        console.error(`❌ Create Workspace Failed:`, createWsData);
        process.exit(1);
    }
    
    const workspace = createWsData.data;
    const workspaceId = workspace.id;
    console.log(`✅ Workspace created successfully. ID: ${workspaceId}, GSTIN: ${workspace.gstn}`);

    console.log(`\n--- STEP 4: List Accessible Workspaces ---`);
    let listWsRes;
    try {
        listWsRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-tenant-id': tenantId
            }
        });
    } catch (err) {
        console.error(`❌ List Workspaces Request Failed:`, err.message);
        process.exit(1);
    }

    const listWsData = await listWsRes.json();
    if (!listWsRes.ok) {
        console.error(`❌ List Workspaces Failed:`, listWsData);
        process.exit(1);
    }
    console.log(`✅ Retreived workspaces count: ${listWsData.data.length}`);

    console.log(`\n--- STEP 5: Fetch Financial Years ---`);
    let fyRes;
    try {
        fyRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces/financial-years`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (err) {
        console.error(`❌ Financial Years Request Failed:`, err.message);
        process.exit(1);
    }

    const fyData = await fyRes.json();
    if (!fyRes.ok) {
        console.error(`❌ Fetch Financial Years Failed:`, fyData);
        process.exit(1);
    }
    console.log(`✅ Financial Years fetched successfully. Years:`, fyData.data);

    console.log(`\n--- STEP 6: Fetch Sidebar Counts ---`);
    let sidebarRes;
    try {
        sidebarRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces/${workspaceId}/sidebar-counts`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-workspace-id': workspaceId,
                'x-tenant-id': tenantId
            }
        });
    } catch (err) {
        console.error(`❌ Sidebar Counts Request Failed:`, err.message);
        process.exit(1);
    }

    const sidebarData = await sidebarRes.json();
    if (!sidebarRes.ok) {
        console.error(`❌ Fetch Sidebar Counts Failed:`, sidebarData);
        process.exit(1);
    }
    console.log(`✅ Sidebar counts successfully retrieved:`, sidebarData.data);

    console.log(`\n🎉 ALL FLOW CHECKS PASSED SUCCESSFULLY!`);
}

runTests();
