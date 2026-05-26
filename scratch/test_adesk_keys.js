const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Map host DB variables for local execution
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5435';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';

const knex = require('../services/shared/src/db/connection');
const ConnectorModel = require('../services/workspace-service/src/connectors/connectorModel');

async function testAdeskKeys() {
    console.log('🚀 Running Adesk API Key Integration Verification Tests...');

    // 1. Get test workspace/tenant from database
    const workspace = await knex('workspaces').first();
    if (!workspace) {
        console.error('❌ No workspaces found in database. Run seed script first.');
        process.exit(1);
    }
    const { id: workspaceId, tenant_id: tenantId, gstn } = workspace;
    console.log(`🏢 Using test Workspace: "${workspace.name}" (ID: ${workspaceId}, Tenant: ${tenantId}, GSTN: ${gstn})`);

    // Clean up any existing keys for this workspace to start clean
    await knex('workspace_api_keys').where({ workspace_id: workspaceId }).delete();
    await ConnectorModel.deleteKeys(workspaceId, tenantId);

    // Test Case 1: Standard Key Generation (Default hex format)
    console.log('\n--- Test Case 1: Default Hex Key Generation ---');
    const defaultKeys = await ConnectorModel.createKeys(workspaceId, tenantId, 'Tally Prime ERP', { foo: 'bar' });
    console.log('Generated keys:', {
        production_key: defaultKeys.production_key,
        sandbox_key: defaultKeys.sandbox_key,
        third_party_name: defaultKeys.third_party_name,
        extrainfo: defaultKeys.extrainfo
    });
    if (defaultKeys.production_key.includes('@@') || defaultKeys.production_key.length !== 32) {
        throw new Error('Test Case 1 failed: Default key should be 32-char hex.');
    }
    console.log('✅ Test Case 1 Passed');

    // Clean up
    await knex('workspace_api_keys').where({ workspace_id: workspaceId }).delete();

    // Test Case 2: Adesk Key Generation (Base64 format with project/org codes)
    console.log('\n--- Test Case 2: Adesk Base64 Key Generation ---');
    const adeskExtraInfo = { project_code: 'my_project_123', org_code: 'my_org_456' };
    const adeskKeys = await ConnectorModel.createKeys(workspaceId, tenantId, 'Adesk Cloud Connector', adeskExtraInfo);
    console.log('Generated keys:', {
        production_key: adeskKeys.production_key,
        sandbox_key: adeskKeys.sandbox_key,
        third_party_name: adeskKeys.third_party_name,
        extrainfo: adeskKeys.extrainfo
    });

    const decodedProd = Buffer.from(adeskKeys.production_key, 'base64').toString('ascii');
    const decodedSand = Buffer.from(adeskKeys.sandbox_key, 'base64').toString('ascii');
    console.log('Decoded production key:', decodedProd);
    console.log('Decoded sandbox key:', decodedSand);

    if (decodedProd !== 'my_project_123@@my_org_456@@' + gstn) {
        throw new Error('Test Case 2 failed: Production key format is incorrect.');
    }
    if (decodedSand !== 'my_project_123@@my_org_456@@' + gstn + '_sandbox') {
        throw new Error('Test Case 2 failed: Sandbox key format is incorrect.');
    }
    console.log('✅ Test Case 2 Passed');

    // Test Case 3: Adesk Key Validation
    console.log('\n--- Test Case 3: Adesk Key Validation ---');
    const prodValidation = await ConnectorModel.validateKey(adeskKeys.production_key);
    console.log('Production validation result:', prodValidation);
    if (!prodValidation || prodValidation.workspaceId !== workspaceId || prodValidation.tenantId !== tenantId || prodValidation.keyType !== 'production') {
        throw new Error('Test Case 3 failed: Production key validation failed.');
    }

    const sandValidation = await ConnectorModel.validateKey(adeskKeys.sandbox_key);
    console.log('Sandbox validation result:', sandValidation);
    if (!sandValidation || sandValidation.workspaceId !== workspaceId || sandValidation.tenantId !== tenantId || sandValidation.keyType !== 'sandbox') {
        throw new Error('Test Case 3 failed: Sandbox key validation failed.');
    }
    console.log('✅ Test Case 3 Passed');

    // Test Case 4: Adesk Key Regeneration
    console.log('\n--- Test Case 4: Adesk Key Regeneration ---');
    const regenerated = await ConnectorModel.regenerateKeys(workspaceId, tenantId, 'production');
    console.log('Regenerated production key:', regenerated.production_key);
    const decodedRegen = Buffer.from(regenerated.production_key, 'base64').toString('ascii');
    console.log('Decoded regenerated key:', decodedRegen);

    if (decodedRegen !== 'my_project_123@@my_org_456@@' + gstn) {
        throw new Error('Test Case 4 failed: Regenerated production key format is incorrect.');
    }
    console.log('✅ Test Case 4 Passed');

    // Clean up
    await knex('workspace_api_keys').where({ workspace_id: workspaceId }).delete();
    console.log('\n🎉 All Adesk API Key integration tests passed successfully!');
}

testAdeskKeys()
    .catch(err => {
        console.error('❌ Test failed with error:', err);
    })
    .finally(() => {
        knex.destroy();
    });
