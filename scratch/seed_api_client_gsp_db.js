const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5438,
    database: 'gsp_api_db',
    user: 'root',
    password: 'rootpassword',
};

async function seed() {
    const client = new Client(dbConfig);
    try {
        await client.connect();

        const apiKey = '8936edc55f36411fa32bbaa23d5e413e'; // 32 chars
        const unauthKey = '822a4b5f5a094f88825b22014b830fda'; // 32 chars

        // Clean up existing test keys to avoid conflict
        await client.query("DELETE FROM api_conn_access_key WHERE production_key IN ($1, $2)", [apiKey, unauthKey]);
        await client.query("DELETE FROM api_conn_allowed_access WHERE api_key IN ($1, $2)", [apiKey, unauthKey]);

        // 1. Seed api_conn_access_key for test client
        await client.query(`
            INSERT INTO api_conn_access_key (
                platform, client_name, contact_email, production_key, sandbox_key, status, mode
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, ['TEST_PLATFORM', 'Test API Client', 'api-test@gmail.com', apiKey, apiKey, 'active', 'PRODUCTION']);
        console.log(`✅ Seeded api_conn_access_key for test client.`);

        // 2. Seed api_conn_access_key for unauth client
        await client.query(`
            INSERT INTO api_conn_access_key (
                platform, client_name, contact_email, production_key, sandbox_key, status, mode
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, ['TEST_PLATFORM_UNAUTH', 'Unauth Lib Client', 'unauth@gmail.com', unauthKey, unauthKey, 'active', 'PRODUCTION']);
        console.log(`✅ Seeded api_conn_access_key for unauth client.`);

        // 3. Seed api_conn_allowed_access for test client (all services allowed)
        await client.query(`
            INSERT INTO api_conn_allowed_access (
                api_key, service_gst, total_gst_api_call, remaining_gst_api_call,
                service_eway_bill, total_eway_bill_api_call, remaining_eway_bill_api_call,
                service_einvoice, total_einvoice_api_call, remaining_einvoice_api_call, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [apiKey, true, 1000, 1000, true, 1000, 1000, true, 1000, 1000, 'active']);
        console.log(`✅ Seeded api_conn_allowed_access for test client key: ${apiKey}`);

        // 4. Seed api_conn_allowed_access for unauth client (only GST allowed)
        await client.query(`
            INSERT INTO api_conn_allowed_access (
                api_key, service_gst, total_gst_api_call, remaining_gst_api_call,
                service_eway_bill, total_eway_bill_api_call, remaining_eway_bill_api_call,
                service_einvoice, total_einvoice_api_call, remaining_einvoice_api_call, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [unauthKey, true, 1000, 1000, false, 0, 0, false, 0, 0, 'active']);
        console.log(`✅ Seeded api_conn_allowed_access for unauth client key: ${unauthKey}`);

        // 5. Seed api_conn_gst_master for tests (clean then insert)
        const gstin = '27AAGCB1286Q1Z4';
        await client.query("DELETE FROM api_conn_gst_master WHERE gstn = $1", [gstin]);
        await client.query(`
            INSERT INTO api_conn_gst_master (
                gstn, legal_name, gst_user_name, state_code, is_active, platform
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [gstin, 'Whitebooks', 'test_user', '27', true, 'TEST_PLATFORM']);
        console.log(`✅ Seeded api_conn_gst_master for GSTIN: ${gstin}`);

    } catch (err) {
        console.error("❌ Seeding error:", err.message);
    } finally {
        await client.end();
    }
}

seed();
