const { Client } = require('pg');
const fetch = require('cross-fetch');
require('dotenv').config({ path: '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/.env' });

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

async function main() {
    console.log('🏁 Starting Inbound Connector API Demo and Verification...');
    const client = new Client(dbConfig);
    await client.connect();

    try {
        // 1. Fetch workspace to use for testing
        const workspaceRes = await client.query("SELECT id, tenant_id, name, gstn FROM workspaces LIMIT 1");
        if (workspaceRes.rows.length === 0) {
            console.error('❌ No workspaces found in database.');
            return;
        }

        const workspace = workspaceRes.rows[0];
        console.log(`\n🏢 Testing with Workspace: "${workspace.name}"`);
        console.log(`   ID: ${workspace.id}`);
        console.log(`   Tenant ID: ${workspace.tenant_id}`);
        console.log(`   GSTIN: ${workspace.gstn}`);

        // 2. Prepare test API Keys
        const testApiKey = 'prod_demo_integration_test_key_99999';
        const testSandboxKey = 'sand_demo_integration_test_key_99999';

        // Clean up previous run if any
        await client.query("DELETE FROM workspace_api_keys WHERE workspace_id = $1", [workspace.id]);

        // Insert API Keys
        await client.query(`
            INSERT INTO workspace_api_keys (
                workspace_id, tenant_id, production_key, sandbox_key, status, mode, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [workspace.id, workspace.tenant_id, testApiKey, testSandboxKey, 'active', 'live']);

        console.log(`✅ Seeded temporary API keys for testing.`);

        // 3. Make HTTP request to import book data
        const payload = {
            type: "purchase_register",
            return_period: "042026",
            records: [
                {
                    vchr_no: "DEMO-API-INV-999",
                    vchr_date: "2026-04-15",
                    supplier_name: "Acme API Supplies Pvt Ltd",
                    supplier_gstin: "24AALFA9789K1ZO",
                    taxable_value: 10000.00,
                    igst: 0.00,
                    cgst: 900.00,
                    sgst: 900.00,
                    total_value: 11800.00
                }
            ]
        };

        console.log(`\n🚀 Sending POST request to /connectors/book-import...`);
        const response = await fetch('http://localhost:3002/connectors/book-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': testApiKey
            },
            body: JSON.stringify(payload)
        });

        const resBody = await response.json();
        console.log('📥 Response Status:', response.status);
        console.log('📥 Response Body:', JSON.stringify(resBody, null, 2));

        if (response.status !== 200 || !resBody.success) {
            console.error('❌ Inbound book import failed.');
            return;
        }

        console.log('✅ Connector API responded successfully.');

        // 4. Verify in DB that the record was created
        console.log(`\n🔍 Querying Database to check if "DEMO-API-INV-999" exists...`);
        const dbCheck = await client.query(
            "SELECT id, book_vchr_no, supplier_name, taxable_total, status FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2",
            ['DEMO-API-INV-999', workspace.id]
        );

        if (dbCheck.rows.length > 0) {
            console.log('🎉 Record Found in Database:');
            console.table(dbCheck.rows);
        } else {
            console.error('❌ Record not found in database.');
        }

        // 5. Cleanup Database
        console.log(`\n🧹 Cleaning up generated test data...`);
        await client.query("DELETE FROM purchase_vouchers WHERE book_vchr_no = $1 AND workspace_id = $2", ['DEMO-API-INV-999', workspace.id]);
        await client.query("DELETE FROM workspace_api_keys WHERE workspace_id = $1", [workspace.id]);
        console.log('✅ Cleanup successful. Database is pristine.');

    } catch (error) {
        console.error('❌ Exception occurred during integration test:', error);
    } finally {
        await client.end();
    }
}

main();
