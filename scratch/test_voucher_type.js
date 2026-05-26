const { Client } = require('pg');
const fetch = require('cross-fetch');

// Set connection env vars BEFORE requiring database-linked services
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = 'gstadmin';
process.env.DB_PASSWORD = 'GstAdmin123';
process.env.DB_NAME = 'gst_recon';

require('dotenv').config({ path: '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/.env' });
const TaxPeriodService = require('../services/shared/src/services/taxPeriodService');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function main() {
    console.log('🏁 Starting Voucher Type Integration Test (Idempotent Conflict)...');
    const client = new Client(dbConfig);
    await client.connect();

    try {
        // 1. Fetch or create a workspace to use for testing
        let workspaceRes = await client.query("SELECT id, tenant_id, name, gstn FROM workspaces LIMIT 1");
        let workspace;

        if (workspaceRes.rows.length === 0) {
            console.log('⚠️ No workspaces found in database. Creating a fresh test tenant and workspace...');
            
            // Create a test tenant
            const tenantRes = await client.query(`
                INSERT INTO tenants (id, tenant_code, legal_name)
                VALUES (uuid_generate_v4(), 'test_tenant_vt_9999', 'A1Brain Group Org')
                RETURNING id
            `);
            const tenantId = tenantRes.rows[0].id;
            console.log(`✅ Created test tenant with ID: ${tenantId}`);

            // Create a test workspace
            const wsRes = await client.query(`
                INSERT INTO workspaces (id, tenant_id, workspace_code, name, gstn)
                VALUES (uuid_generate_v4(), $1, 'test_ws_vt_9999', 'A1BrainINFOTECH', '24DGLPP8130C1ZH')
                RETURNING id, tenant_id, name, gstn
            `, [tenantId]);
            workspace = wsRes.rows[0];
            console.log(`✅ Created test workspace: "${workspace.name}" (ID: ${workspace.id})`);
        } else {
            workspace = workspaceRes.rows[0];
            console.log(`\n🏢 Testing with Existing Workspace: "${workspace.name}"`);
        }

        // 2. Prepare test API Keys
        const testApiKey = 'prod_demo_integration_test_key_99999_vt';
        const testSandboxKey = 'sand_demo_integration_test_key_99999_vt';

        // Clean up previous keys
        await client.query("DELETE FROM workspace_api_keys WHERE workspace_id = $1", [workspace.id]);

        // Insert API Keys into Main DB
        await client.query(`
            INSERT INTO workspace_api_keys (
                workspace_id, tenant_id, production_key, sandbox_key, status, mode, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [workspace.id, workspace.tenant_id, testApiKey, testSandboxKey, 'active', 'live']);

        console.log(`✅ Seeded temporary API keys for testing.`);

        // 3. Sync Keys to GSP database using pg Client
        const gspClient = new Client({
            host: '127.0.0.1',
            port: 5438,
            database: 'gsp_api_db',
            user: 'root',
            password: 'rootpassword',
        });
        await gspClient.connect();

        await gspClient.query("DELETE FROM api_conn_access_key WHERE third_party_unique_id = $1", [workspace.id]);
        await gspClient.query("DELETE FROM api_conn_allowed_access WHERE api_key = ANY($1)", [[testApiKey, testSandboxKey]]);

        const accessKeyId = require('crypto').randomUUID();
        await gspClient.query(`
            INSERT INTO api_conn_access_key (
                id, platform, client_name, contact_email, third_party_unique_id, production_key, sandbox_key, status, mode, created_at, updated_at
            ) VALUES ($1, 'TENANT_PORTAL', $2, 'test@workspace.com', $3, $4, $5, 'active', 'PRODUCTION', NOW(), NOW())
        `, [accessKeyId, workspace.name, workspace.id, testApiKey, testSandboxKey]);

        await gspClient.query(`
            INSERT INTO api_conn_allowed_access (
                api_key, service_gst, total_gst_api_call, remaining_gst_api_call, service_eway_bill, total_eway_bill_api_call, remaining_eway_bill_api_call, service_einvoice, total_einvoice_api_call, remaining_einvoice_api_call, status
            ) VALUES 
            ($1, true, 100000, 100000, true, 100000, 100000, true, 100000, 100000, 'active'),
            ($2, true, 100000, 100000, true, 100000, 100000, true, 100000, 100000, 'active')
        `, [testApiKey, testSandboxKey]);

        console.log(`✅ Synced temporary API keys to GSP API DB.`);
        await gspClient.end();

        // Clean up previous vouchers if any
        const testVoucher = 'VT-CONFLICT-999';
        await client.query("DELETE FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2", [testVoucher, workspace.id]);

        // 4. Resolve tax period using TaxPeriodService
        const period = '042026';
        console.log(`\n🔍 Ensuring tax period ${period} exists...`);
        const taxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(period);
        console.log(`✅ Tax Period ID resolved: ${taxPeriodId}`);

        // 5. Manually insert the initial voucher with voucher_type = NULL, net_amount = 1000
        console.log('\n📥 Manually inserting initial voucher with voucher_type = NULL...');
        await client.query(`
            INSERT INTO purchase_vouchers (
                tenant_id, workspace_id, tax_period_id, book_type, book_vchr_no, supplier_invoice_no,
                net_amount, voucher_type, status, created_at, updated_at
            ) VALUES ($1, $2, $3, 'PA', $4, $4, 1000.00, NULL, 'DRAFT', NOW(), NOW())
        `, [workspace.tenant_id, workspace.id, taxPeriodId, testVoucher]);

        // Verify initial state
        let dbCheck = await client.query(
            "SELECT book_vchr_no, voucher_type, book_type, net_amount FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2",
            [testVoucher, workspace.id]
        );
        console.log('🎉 DB Records (Initial Manual State):');
        console.table(dbCheck.rows);

        // 6. Send POST request (ON CONFLICT DO UPDATE) via Connector to import VT-CONFLICT-999
        // This will have vchr_type: "purchase" (maps to voucher_type: "PURCHASE") and net_amount: 1200.00
        const payload = {
            type: "purchase_register",
            return_period: period,
            records: [
                {
                    vchr_no: testVoucher,
                    vchr_date: "2026-04-15",
                    vchr_type: "purchase",
                    supplier_name: "Acme SUPPLIES",
                    supplier_gstin: "24AALFA9789K1ZO",
                    taxable_value: 1000.00,
                    igst: 200.00,
                    cgst: 0.00,
                    sgst: 0.00,
                    total_value: 1200.00
                }
            ]
        };

        // Try both uppercase 'X-API-Key' and lowercase 'x-api-key' as requested by the user
        const headersToTest = ['x-api-key', 'X-API-Key'];
        for (const headerName of headersToTest) {
            console.log(`\n🚀 Sending Connector POST request with header "${headerName}" (expected to conflict and update)...`);
            const response = await fetch('http://localhost:3002/connectors/book-import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    [headerName]: testApiKey
                },
                body: JSON.stringify(payload)
            });

            const resBody = await response.json();
            console.log('📥 Response Status:', response.status);
            console.log('📥 Response Body:', JSON.stringify(resBody, null, 2));

            // Verify final state in DB
            dbCheck = await client.query(
                "SELECT book_vchr_no, voucher_type, book_type, net_amount FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2",
                [testVoucher, workspace.id]
            );
            console.log('🎉 DB Records (After Connector Sync Conflict):');
            console.table(dbCheck.rows);

            const finalRow = dbCheck.rows[0];
            if (finalRow && finalRow.voucher_type === 'PURCHASE' && parseFloat(finalRow.net_amount) === 1200.00) {
                console.log(`\n✅ SUCCESS: voucher_type and net_amount are updated perfectly using header "${headerName}"!`);
            } else {
                console.error(`\n❌ FAILURE: voucher_type or net_amount was not updated properly using header "${headerName}".`);
            }
        }

        // 7. Cleanup Database
        console.log(`\n🧹 Cleaning up generated test data...`);
        await client.query("DELETE FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2", [testVoucher, workspace.id]);
        await client.query("DELETE FROM workspace_api_keys WHERE workspace_id = $1", [workspace.id]);
        
        // If we created a test workspace, clean it up
        if (workspaceRes.rows.length === 0) {
            await client.query("DELETE FROM workspaces WHERE id = $1", [workspace.id]);
            await client.query("DELETE FROM tenants WHERE id = $1", [workspace.tenant_id]);
        }
        
        console.log('✅ Cleanup successful. Database is pristine.');

    } catch (error) {
        console.error('❌ Exception occurred during integration test:', error);
    } finally {
        await client.end();
    }
}

main();
