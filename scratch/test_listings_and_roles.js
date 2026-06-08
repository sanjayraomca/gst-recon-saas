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
const WORKSPACE_SERVICE_URL = 'http://localhost:3002';

async function runTests() {
    const timestamp = Date.now();
    const adminEmail = `admin_${timestamp}@example.com`;
    const memberEmail = `member_${timestamp}@example.com`;
    const password = 'Password123';

    console.log(`\n==================================================`);
    console.log(`🚀 SETUP: Creating Admin and Workspace...`);
    console.log(`==================================================`);

    // 1. Register Tenant Admin
    const adminSignupRes = await fetch(`${TENANT_SERVICE_URL}/tenants/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: adminEmail,
            password: password,
            full_name: 'Workspace Admin User',
            phone: '9999999999'
        })
    });
    const adminSignupData = await adminSignupRes.json();
    if (!adminSignupRes.ok) {
        console.error('❌ Admin Register Failed:', adminSignupData);
        process.exit(1);
    }
    console.log(`✅ Admin user registered: ${adminEmail}`);

    // 2. Login Admin
    const adminLoginRes = await fetch(`${TENANT_SERVICE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: password })
    });
    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.data.access_token;
    const tenantId = adminLoginData.data.tenant_id;
    console.log(`✅ Admin logged in. Tenant ID: ${tenantId}`);

    // 3. Create Workspace
    const createWsRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`,
            'x-tenant-id': tenantId
        },
        body: JSON.stringify({
            code: '29AABCD1234E1ZF',
            name: `E2E Workspace ${timestamp}`,
            type: 'COMPANY',
            filing_frequency: 'monthly',
            state: '29-Karnataka',
            city: 'Bengaluru',
            email: adminEmail
        })
    });
    const createWsData = await createWsRes.json();
    const workspaceId = createWsData.data.id;
    console.log(`✅ Workspace created: ${workspaceId}`);

    // 4. Create Member User
    const memberSignupRes = await fetch(`${TENANT_SERVICE_URL}/tenants/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: memberEmail,
            password: password,
            full_name: 'Workspace Member User',
            phone: '8888888888'
        })
    });
    const memberSignupData = await memberSignupRes.json();
    if (!memberSignupRes.ok) {
        console.error('❌ Member Register Failed:', memberSignupData);
        process.exit(1);
    }
    console.log(`✅ Member user registered: ${memberEmail}`);

    // Login Member
    const memberLoginRes = await fetch(`${TENANT_SERVICE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: memberEmail, password: password })
    });
    const memberLoginData = await memberLoginRes.json();
    const memberToken = memberLoginData.data.access_token;
    console.log(`✅ Member logged in.`);

    // 5. Connect and insert mock data using PG Client
    console.log(`\n⏳ Seeding mock data in Database...`);
    const pgClient = new Client(dbConfig);
    await pgClient.connect();

    const invoiceId = require('crypto').randomUUID();
    const gstr2bId = require('crypto').randomUUID();
    const importFilingId = require('crypto').randomUUID();

    // Insert import master record (matching actual DB columns)
    await pgClient.query(`
        INSERT INTO gstr_import_master 
        (import_filing_id, workspace_id, tenant_uuid, gstin_recipient, return_period, financial_year, generation_date, import_type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [importFilingId, workspaceId, tenantId, '29AABCD1234E1ZF', '112024', '2024-25', '2024-11-30', 'GSTR2B', 'Completed']);

    // Insert purchase voucher record
    await pgClient.query(`
        INSERT INTO purchase_vouchers 
        (id, workspace_id, tenant_id, supplier_invoice_no, supplier_invoice_date, supplier_gstin, supplier_name, net_amount, taxable_total, total_cgst_amount, total_sgst_amount, voucher_type, status, import_filing_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [invoiceId, workspaceId, tenantId, 'INV-TEST-001', '2024-11-01', '29SUPP1234A1Z1', 'Mock Supplier Inc', 118000.00, 100000.00, 9000.00, 9000.00, 'PURCHASE', 'APPROVED', importFilingId]);

    // Insert normalized gstr2b invoice
    await pgClient.query(`
        INSERT INTO normalized_gstr2b_invoices 
        (id, workspace_id, tenant_id, import_filing_id, source_section, supplier_gstin, supplier_name, document_number_raw, document_date, document_value, taxable_value, cgst, sgst, reconciliation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [gstr2bId, workspaceId, tenantId, importFilingId, 'B2B', '29SUPP1234A1Z1', 'Mock Supplier Inc', 'INV-TEST-001', '2024-11-01', 118000.00, 100000.00, 9000.00, 9000.00, 'PENDING']);
    
    console.log(`✅ Seeded 1 Purchase Invoice and 1 GSTR-2B entry.`);

    console.log(`\n==================================================`);
    console.log(`🔐 TESTING ROLE-BASED ACCESS CONTROL (RBAC)`);
    console.log(`==================================================`);

    // Test A: Accessing workspace before joining
    console.log(`Test A: Accessing workspace before joining...`);
    const preJoinRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces/${workspaceId}/sidebar-counts`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    console.log(`Result A: Status Code = ${preJoinRes.status} (Expected: 403)`);
    if (preJoinRes.status === 403) {
        console.log(`✅ Passed: Unauthorized access correctly blocked with 403 Forbidden.`);
    } else {
        console.error(`❌ Failed: Unauthorized access returned status ${preJoinRes.status}`);
    }

    // Test B: Associate Member User to Workspace and set as active
    console.log(`\nTest B: Linking member user to workspace as ACTIVE...`);
    const userResult = await pgClient.query('SELECT id FROM users WHERE email = $1', [memberEmail]);
    const memberId = userResult.rows[0].id;

    await pgClient.query(`
        INSERT INTO workspace_users (id, workspace_id, user_id, role, invitation_status, joined_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
    `, [require('crypto').randomUUID(), workspaceId, memberId, 'VIEWER', 'ACTIVE']);
    console.log(`✅ Member user associated as ACTIVE in workspace_users table.`);

    // Test C: Accessing workspace after joining
    console.log(`\nTest C: Accessing workspace after joining...`);
    const postJoinRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces/${workspaceId}/sidebar-counts`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const postJoinData = await postJoinRes.json();
    console.log(`Result C: Status Code = ${postJoinRes.status} (Expected: 200)`);
    if (postJoinRes.status === 200) {
        console.log(`✅ Passed: Authorized access correctly allowed. Metrics:`, postJoinData.data);
    } else {
        console.error(`❌ Failed: Authorized access failed with status ${postJoinRes.status}`, postJoinData);
    }

    console.log(`\n==================================================`);
    console.log(`📋 TESTING LISTINGS AND FILTERS FUNCTIONALITIES`);
    console.log(`==================================================`);

    // 1. Purchase Invoices Listing without filters
    console.log(`\n1. Fetching Purchase Invoices Listing (No filters)...`);
    const piListRes = await fetch(`${WORKSPACE_SERVICE_URL}/purchase-invoices`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const piListData = await piListRes.json();
    if (piListRes.ok) {
        console.log(`✅ Passed: Purchase Invoice Listing fetched successfully. Invoices found: ${piListData.data.invoices.length}`);
    } else {
        console.error(`❌ Failed: Fetching listing without filters failed:`, piListData);
    }

    // 2. GSTR-2B Invoices Listing without filters
    console.log(`\n2. Fetching GSTR-2B Invoices Listing (No filters)...`);
    const gstrListRes = await fetch(`${WORKSPACE_SERVICE_URL}/gstr2b-invoices`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const gstrListData = await gstrListRes.json();
    if (gstrListRes.ok) {
        console.log(`✅ Passed: GSTR-2B Listing fetched successfully. Invoices found: ${gstrListData.data.invoices.length}`);
    } else {
        console.error(`❌ Failed: Fetching GSTR-2B listing without filters failed:`, gstrListData);
    }

    // 3. Purchase Invoice SEARCH filter bug check
    console.log(`\n3. Testing Purchase Invoice [search] filter...`);
    const searchRes = await fetch(`${WORKSPACE_SERVICE_URL}/purchase-invoices?search=TEST`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const searchData = await searchRes.json();
    console.log(`Result 3: Status = ${searchRes.status}`);
    if (searchRes.status === 500) {
        console.log(`✅ Detected Bug: Purchase Invoice search filter fails with 500 Server Error.`);
        console.log(`   Error Message: "${searchData.error}"`);
    } else {
        console.log(`ℹ️ Search filter succeeded or skipped:`, searchData);
    }

    // 4. Purchase Invoice DATE range filter bug check
    console.log(`\n4. Testing Purchase Invoice [invoice_date_from] filter...`);
    const dateFilterRes = await fetch(`${WORKSPACE_SERVICE_URL}/purchase-invoices?invoice_date_from=2024-11-01`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const dateFilterData = await dateFilterRes.json();
    console.log(`Result 4: Status = ${dateFilterRes.status}`);
    if (dateFilterRes.status === 500) {
        console.log(`✅ Detected Bug: Purchase Invoice date range filter fails with 500 Server Error.`);
        console.log(`   Error Message: "${dateFilterData.error}"`);
    } else {
        console.log(`ℹ️ Date filter succeeded or skipped:`, dateFilterData);
    }

    // 5. GSTR-2B MATCH STATUS filter bug check
    console.log(`\n5. Testing GSTR-2B [match_status] filter...`);
    const matchFilterRes = await fetch(`${WORKSPACE_SERVICE_URL}/gstr2b-invoices?match_status=PENDING`, {
        headers: {
            'Authorization': `Bearer ${memberToken}`,
            'x-workspace-id': workspaceId,
            'x-tenant-id': tenantId
        }
    });
    const matchFilterData = await matchFilterRes.json();
    console.log(`Result 5: Status = ${matchFilterRes.status}`);
    if (matchFilterRes.status === 500) {
        console.log(`✅ Detected Bug: GSTR-2B match_status filter fails with 500 Server Error.`);
        console.log(`   Error Message: "${matchFilterData.error}"`);
    } else {
        console.log(`ℹ️ Match status filter succeeded or skipped:`, matchFilterData);
    }

    await pgClient.end();
    console.log(`\n==================================================`);
    console.log(`🏁 FINISHED TESTING LISTINGS, FILTERS, & RBAC.`);
    console.log(`==================================================`);
    process.exit(0);
}

runTests().catch(err => {
    console.error('Fatal Test Run Error:', err);
    process.exit(1);
});
