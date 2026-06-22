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
    const adminEmail = `audit_admin_${timestamp}@example.com`;
    const password = 'Password123';

    console.log(`\n==================================================`);
    console.log(`🚀 SETUP: Creating Admin, Workspace, and Seeding Mock Data...`);
    console.log(`==================================================`);

    // 1. Register Tenant Admin
    const signupRes = await fetch(`${TENANT_SERVICE_URL}/tenants/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: adminEmail,
            password: password,
            full_name: 'Audit Admin User',
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
    const tenantId = loginData.data.tenant_id;
    console.log(`✅ Admin logged in. Tenant ID: ${tenantId}`);

    // 3. Create Workspace
    const createWsRes = await fetch(`${WORKSPACE_SERVICE_URL}/workspaces`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-tenant-id': tenantId
        },
        body: JSON.stringify({
            code: '29AABCD1234E1ZF',
            name: `Audit Workspace ${timestamp}`,
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

    // 4. Seeding via Postgres pg Client
    const pgClient = new Client(dbConfig);
    await pgClient.connect();

    const invoiceId = require('crypto').randomUUID();
    const importFilingId = require('crypto').randomUUID();
    const customerId = require('crypto').randomUUID();
    const supplierId = require('crypto').randomUUID();
    const decisionId = require('crypto').randomUUID();
    const reversalId = require('crypto').randomUUID();
    const liabilityId = require('crypto').randomUUID();

    // Seed Import Master
    await pgClient.query(`
        INSERT INTO gstr_import_master 
        (import_filing_id, workspace_id, tenant_uuid, gstin_recipient, return_period, financial_year, generation_date, import_type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [importFilingId, workspaceId, tenantId, '29AABCD1234E1ZF', '112024', '2024-25', '2024-11-30', 'GSTR2B', 'Completed']);

    // Seed Purchase Voucher
    await pgClient.query(`
        INSERT INTO purchase_vouchers 
        (id, workspace_id, tenant_id, supplier_invoice_no, supplier_invoice_date, supplier_gstin, supplier_name, net_amount, taxable_total, total_cgst_amount, total_sgst_amount, voucher_type, status, import_filing_id, is_rcm, itc_eligible)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [invoiceId, workspaceId, tenantId, 'INV-AUDIT-001', '2024-11-01', '29SUPP1234A1Z1', 'Audit Supplier Inc', 118000.00, 100000.00, 9000.00, 9000.00, 'PURCHASE', 'APPROVED', importFilingId, false, true]);

    // Seed GSTR-2B Invoice
    await pgClient.query(`
        INSERT INTO normalized_gstr2b_invoices 
        (id, workspace_id, tenant_id, import_filing_id, source_section, supplier_gstin, supplier_name, document_number_raw, document_date, document_value, taxable_value, cgst, sgst, reconciliation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [require('crypto').randomUUID(), workspaceId, tenantId, importFilingId, 'B2B', '29SUPP1234A1Z1', 'Audit Supplier Inc', 'INV-AUDIT-001', '2024-11-01', 118000.00, 100000.00, 9000.00, 9000.00, 'PENDING']);

    // Seed Customer Master
    await pgClient.query(`
        INSERT INTO customer_master (id, workspace_id, gstin, customer_name, is_active)
        VALUES ($1, $2, $3, $4, $5)
    `, [customerId, workspaceId, '29CUST1234B1Z1', 'Audit Customer Inc', true]);

    // Seed Supplier Master
    await pgClient.query(`
        INSERT INTO supplier_master (id, workspace_id, gstin, supplier_name, is_active)
        VALUES ($1, $2, $3, $4, $5)
    `, [supplierId, workspaceId, '29SUPP1234A1Z1', 'Audit Supplier Inc', true]);

    // Seed ITC Decision
    // We must catch if it has column mismatches since it has columns (id, workspace_id, purchase_invoice_id, period_id, itc_status, remarks, etc.)
    await pgClient.query(`
        INSERT INTO itc_decisions (id, workspace_id, purchase_invoice_id, period_id, itc_status, remarks)
        VALUES ($1, $2, $3, NULL, $4, $5)
    `, [decisionId, workspaceId, invoiceId, 'ELIGIBLE', 'Audited status remarks']);

    // Seed ITC Reversal Register
    await pgClient.query(`
        INSERT INTO itc_reversal_register (id, workspace_id, gstin_id, period_id, purchase_invoice_id, reversal_type, reversal_amount, is_reclaimable)
        VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
    `, [reversalId, workspaceId, supplierId, invoiceId, '180_DAY_RULE', 5000.00, true]);

    // Seed RCM Liability Register
    await pgClient.query(`
        INSERT INTO rcm_liability_register (id, workspace_id, gstin_id, period_id, purchase_invoice_id, tax_type, tax_amount, liability_status)
        VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
    `, [liabilityId, workspaceId, supplierId, invoiceId, 'CGST', 9000.00, 'PENDING']);

    // Seed Connector Log
    await pgClient.query(`
        INSERT INTO tig_inbound_outbound_log (id, type, request_type, tenant_id, org_id, status)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [require('crypto').randomUUID(), 'inbound', 'invoice_sync', tenantId, workspaceId, 'success']);

    console.log(`✅ Seeded all mock data across tables.`);
    await pgClient.end();

    const requestHeaders = {
        'Authorization': `Bearer ${token}`,
        'x-workspace-id': workspaceId,
        'x-tenant-id': tenantId
    };

    console.log(`\n==================================================`);
    console.log(`🔍 AUDITING: Testing All Listing API endpoints & Filters...`);
    console.log(`==================================================`);

    const endpointsToTest = [
        {
            name: '1. Purchase Invoices (Normal Fetch)',
            url: `${WORKSPACE_SERVICE_URL}/purchase-invoices`,
            expectedStatus: 200
        },
        {
            name: '2. Purchase Invoices (?search=XXX) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/purchase-invoices?search=Audit`,
            expectedStatus: 500
        },
        {
            name: '3. Purchase Invoices (?invoice_date_from=2024-11-01) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/purchase-invoices?invoice_date_from=2024-11-01`,
            expectedStatus: 500
        },
        {
            name: '4. Purchase Invoices (?itc_eligibility_status=eligible) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/purchase-invoices?itc_eligibility_status=eligible`,
            expectedStatus: 500
        },
        {
            name: '5. Purchase Invoices (?reverse_charge=true) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/purchase-invoices?reverse_charge=true`,
            expectedStatus: 500
        },
        {
            name: '6. GSTR-2B Invoices (Normal Fetch)',
            url: `${WORKSPACE_SERVICE_URL}/gstr2b-invoices`,
            expectedStatus: 200
        },
        {
            name: '7. GSTR-2B Invoices (?match_status=PENDING) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/gstr2b-invoices?match_status=PENDING`,
            expectedStatus: 500
        },
        {
            name: '8. Book Data (Sales Invoice Fetch)',
            url: `${WORKSPACE_SERVICE_URL}/book-data?type=sales_invoice`,
            expectedStatus: 200
        },
        {
            name: '9. Customers Listing',
            url: `${WORKSPACE_SERVICE_URL}/customers`,
            expectedStatus: 200
        },
        {
            name: '10. Customers Listing (?search=Audit)',
            url: `${WORKSPACE_SERVICE_URL}/customers?search=Audit`,
            expectedStatus: 200
        },
        {
            name: '11. Suppliers Listing',
            url: `${WORKSPACE_SERVICE_URL}/suppliers`,
            expectedStatus: 200
        },
        {
            name: '12. Suppliers Listing (?search=Audit)',
            url: `${WORKSPACE_SERVICE_URL}/suppliers?search=Audit`,
            expectedStatus: 200
        },
        {
            name: '13. Connector Sync Logs Listing',
            url: `${WORKSPACE_SERVICE_URL}/connector-logs`,
            expectedStatus: 200
        },
        {
            name: '14. ITC Decisions (Router Mount path `/itc-decisions/itc-decisions`)',
            url: `${WORKSPACE_SERVICE_URL}/itc-decisions/itc-decisions`,
            expectedStatus: 200
        },
        {
            name: '15. ITC Decisions (Wrong/Expected route Path `/itc-decisions`)',
            url: `${WORKSPACE_SERVICE_URL}/itc-decisions`,
            expectedStatus: 404
        },
        {
            name: '16. ITC Decisions (?decision=CLAIM) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/itc-decisions/itc-decisions?decision=CLAIM`,
            expectedStatus: 500
        },
        {
            name: '17. ITC Decisions (?gstin_id=123) [EXPECTED CRASH]',
            url: `${WORKSPACE_SERVICE_URL}/itc-decisions/itc-decisions?gstin_id=123`,
            expectedStatus: 500
        },
        {
            name: '18. ITC Reversals (Router Mount path `/itc-reversals/itc-reversals`)',
            url: `${WORKSPACE_SERVICE_URL}/itc-reversals/itc-reversals`,
            expectedStatus: 200
        },
        {
            name: '19. RCM Liabilities Listing',
            url: `${WORKSPACE_SERVICE_URL}/rcm-liabilities`,
            expectedStatus: 200
        }
    ];

    for (const test of endpointsToTest) {
        console.log(`\n--------------------------------------------------`);
        console.log(`Running: ${test.name}`);
        console.log(`URL: ${test.url}`);
        try {
            const res = await fetch(test.url, { headers: requestHeaders });
            const data = await res.json();
            console.log(`Status Code: ${res.status} (Expected: ${test.expectedStatus})`);
            if (res.status === test.expectedStatus) {
                console.log(`✅ Success/Expected Outcome!`);
            } else {
                console.log(`⚠️ Mismatch or Error: Received ${res.status}`);
            }
            if (!res.ok) {
                console.log(`Error Response Body:`, JSON.stringify(data));
            } else {
                console.log(`Response Data Sample:`, JSON.stringify(data).substring(0, 160) + '...');
            }
        } catch (err) {
            console.error(`❌ Request Failed critically:`, err.message);
        }
    }

    console.log(`\n==================================================`);
    console.log(`🏁 FINISHED AUDITING ALL LISTINGS & FILTERS.`);
    console.log(`==================================================`);
    process.exit(0);
}

runTests().catch(err => {
    console.error('Fatal Audit Run Error:', err);
    process.exit(1);
});
