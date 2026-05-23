const connectorModel = require('../src/connectors/connectorModel');
const knex = require('../../shared/src/db/connection');
const gspDb = require('knex')({
    client: 'pg',
    connection: {
        host: 'gsp_api_db',
        port: 5432,
        database: 'gsp_api_db',
        user: 'root',
        password: 'rootpassword',
    }
});

const workspaceId = 'a5045bfa-f33f-42f4-87ef-c51ce0009f2f';
const tenantId = '0044210a-9d5e-452f-903e-65dc3f74cf2a';

async function verify() {
    console.log('=== STARTING SYNC FLOW VERIFICATION ===');

    try {
        // 1. Cleanup
        console.log('\n[1/5] Cleaning up existing keys...');
        await connectorModel.deleteKeys(workspaceId, tenantId);

        // 2. Create Keys
        console.log('\n[2/5] Creating new keys...');
        const record = await connectorModel.createKeys(workspaceId, tenantId);
        console.log('Created keys:', {
            production_key: record.production_key,
            sandbox_key: record.sandbox_key
        });

        // Assert length
        if (record.production_key.length !== 32 || record.sandbox_key.length !== 32) {
            throw new Error(`Keys are not 32-character hex strings! ProKey: ${record.production_key.length}, SandKey: ${record.sandbox_key.length}`);
        }

        // Verify in main DB
        console.log('Verifying in Main DB...');
        const mainAccess = await knex('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        if (!mainAccess) throw new Error('No access key row found in Main DB!');
        console.log('Main DB access key found:', {
            production_key: mainAccess.production_key,
            sandbox_key: mainAccess.sandbox_key,
            status: mainAccess.status
        });

        const mainAllowedProd = await knex('api_conn_allowed_access').where({ api_key: record.production_key }).first();
        if (!mainAllowedProd) throw new Error('No production allowed access found in Main DB!');
        console.log('Main DB allowed access (production) verified.');

        // Verify in GSP DB
        console.log('Verifying in GSP DB...');
        const gspAccess = await gspDb('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        if (!gspAccess) throw new Error('No access key row found in GSP DB!');
        console.log('GSP DB access key found:', {
            production_key: gspAccess.production_key,
            sandbox_key: gspAccess.sandbox_key,
            status: gspAccess.status
        });

        const gspAllowedProd = await gspDb('api_conn_allowed_access').where({ api_key: record.production_key }).first();
        if (!gspAllowedProd) throw new Error('No production allowed access found in GSP DB!');
        console.log('GSP DB allowed access (production) verified.');

        // 3. Regenerate Keys
        console.log('\n[3/5] Regenerating production key...');
        const regRecord = await connectorModel.regenerateKeys(workspaceId, tenantId, 'production');
        console.log('Regenerated production key:', regRecord.production_key);
        console.log('Preserved sandbox key:', regRecord.sandbox_key);

        // Check if DBs updated
        const mainAccessReg = await knex('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        const gspAccessReg = await gspDb('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();

        if (mainAccessReg.production_key !== regRecord.production_key || gspAccessReg.production_key !== regRecord.production_key) {
            throw new Error('Regenerated production key did not propagate to Main DB or GSP DB!');
        }
        console.log('SUCCESS! Regenerated key propagated to both databases.');

        // Check allowed access for regenerated key
        const mainAllowedProdReg = await knex('api_conn_allowed_access').where({ api_key: regRecord.production_key }).first();
        const gspAllowedProdReg = await gspDb('api_conn_allowed_access').where({ api_key: regRecord.production_key }).first();
        if (!mainAllowedProdReg || !gspAllowedProdReg) {
            throw new Error('Regenerated allowed access records not found in databases!');
        }
        console.log('Allowed access records successfully synced for regenerated key.');

        // 4. Update Keys Status
        console.log('\n[4/5] Disabling API keys (updating status to inactive)...');
        await connectorModel.updateKeys(workspaceId, tenantId, { status: 'inactive' });

        const mainAccessDisabled = await knex('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        const gspAccessDisabled = await gspDb('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        if (mainAccessDisabled.status !== 'inactive' || gspAccessDisabled.status !== 'inactive') {
            throw new Error('Status update to inactive failed to propagate!');
        }
        console.log('SUCCESS! Inactive status propagated to both databases.');

        // 5. Delete Keys
        console.log('\n[5/5] Deleting keys...');
        await connectorModel.deleteKeys(workspaceId, tenantId);

        // Verify deletion
        const mainAccessDel = await knex('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        const gspAccessDel = await gspDb('api_conn_access_key').where({ third_party_unique_id: workspaceId }).first();
        if (mainAccessDel || gspAccessDel) {
            throw new Error('Keys were not successfully cleaned up on deletion!');
        }
        console.log('SUCCESS! Keys successfully deleted and cleaned up from all databases.');

        console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
    } catch (error) {
        console.error('\n❌ VERIFICATION FAILED:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await gspDb.destroy();
        process.exit(0);
    }
}

verify();
