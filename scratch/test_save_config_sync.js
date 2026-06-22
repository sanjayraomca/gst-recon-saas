const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Map host DB variables for local execution
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';

const knex = require('../services/shared/src/db/connection');
const workspaceController = require('../services/workspace-service/src/controllers/workspaceController');

async function testSaveConfigSync() {
    console.log('🚀 Running E2E Test: Workspace Settings Save Config Sync to workspace_api_keys table...');

    // 1. Get a test workspace
    const workspace = await knex('workspaces').first();
    if (!workspace) {
        console.error('❌ No workspaces found in database.');
        process.exit(1);
    }
    const { id: workspaceId, name, tenant_id: tenantId, gstn } = workspace;
    console.log(`🏢 Test Workspace: "${name}" (ID: ${workspaceId}, Tenant: ${tenantId}, GSTN: ${gstn})`);

    // Clean up key table first
    await knex('workspace_api_keys').where({ workspace_id: workspaceId }).delete();

    // 2. Define custom project and org codes for Adesk
    const projectCode = 'save_config_proj_111';
    const orgCode = 'save_config_org_222';
    const apiTokenRaw = `${projectCode}@@${orgCode}@@${gstn}`;
    const apiTokenBase64 = Buffer.from(apiTokenRaw).toString('base64');

    // 3. Mock express request and response objects
    const req = {
        params: { id: workspaceId },
        body: {
            settings: {
                adeskCloudConnector: {
                    cloudUrl: 'http://localhost:3002/connectors/mock-adesk',
                    apiToken: apiTokenBase64,
                    syncFrequency: 'realtime',
                    autoSyncEnabled: true,
                    syncObjects: { sales: true, purchases: true, suppliers: true, ledgers: false }
                }
            }
        }
    };

    let responseStatus = null;
    let responseData = null;

    const res = {
        status: function(code) {
            responseStatus = code;
            return this;
        },
        json: function(data) {
            responseData = data;
            return this;
        }
    };

    // 4. Invoke updateWorkspace controller directly
    console.log('Invoking updateWorkspace controller with settings payload...');
    await workspaceController.updateWorkspace(req, res);

    console.log(`Response received (Status: ${responseStatus || 200}):`, responseData);

    if (responseData && responseData.success === false) {
        throw new Error(`Controller returned failure: ${responseData.error || JSON.stringify(responseData)}`);
    }

    // 5. Query workspace_api_keys table to verify the key was automatically saved!
    const savedKey = await knex('workspace_api_keys').where({ workspace_id: workspaceId }).first();
    console.log('\n--- Ingress Key Record in workspace_api_keys ---');
    console.log(savedKey);

    if (!savedKey) {
        throw new Error('Test failed: No key record created in workspace_api_keys.');
    }

    if (savedKey.production_key !== apiTokenBase64) {
        throw new Error(`Test failed: Expected production_key to be "${apiTokenBase64}" but got "${savedKey.production_key}"`);
    }

    const extra = typeof savedKey.extrainfo === 'string' ? JSON.parse(savedKey.extrainfo) : savedKey.extrainfo;
    if (extra.project_code !== projectCode || extra.org_code !== orgCode) {
        throw new Error(`Test failed: Incorrect extrainfo content: ${JSON.stringify(extra)}`);
    }

    if (savedKey.third_party_name !== 'Adesk') {
        throw new Error(`Test failed: Expected third_party_name to be "Adesk" but got "${savedKey.third_party_name}"`);
    }

    // Clean up key table
    await knex('workspace_api_keys').where({ workspace_id: workspaceId }).delete();

    console.log('\n✅ Test passed successfully! Adesk configuration settings synced to workspace_api_keys table perfectly.');
}

testSaveConfigSync()
    .catch(err => {
        console.error('❌ Test failed with error:', err);
    })
    .finally(() => {
        knex.destroy();
    });
