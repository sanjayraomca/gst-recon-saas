require('dotenv').config();
process.env.DB_NAME = process.env.DB_NAME || process.env.POSTGRES_MAIN_DB;
process.env.DB_USER = process.env.DB_USER || process.env.POSTGRES_MAIN_USER;
process.env.DB_PASSWORD = process.env.DB_PASSWORD || process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || 5435;

const Reconciliation2AModel = require('../services/workspace-service/src/models/reconciliation2AModel');
const knex = require('../services/shared/src/db/connection');

async function testRecon() {
    const workspaceId = '4cabfd08-31fe-4e7f-b341-ea2ab597d058';
    const gstinId = 'e7d6b22b-dcd1-4626-b9d5-d87646da49f9';
    
    console.log('Testing GSTR-2A Reconciliation Pipeline...');
    
    try {
        // 1. Create a run
        console.log('Creating PURCHASE_2A run...');
        const runId = await Reconciliation2AModel.createRun(workspaceId, {
            gstin_id: gstinId,
            period: '032026',
            run_type: 'PURCHASE_2A',
            run_mode: 'MANUAL'
        });
        
        console.log(`Run created with ID: ${runId}`);
        
        // 2. Wait for background task to finish (polling status)
        console.log('Waiting for reconciliation to complete...');
        let status = 'RUNNING';
        let attempts = 0;
        while (status === 'RUNNING' && attempts < 10) {
            const run = await knex('reconciliation_runs').where({ id: runId }).first();
            status = run.status;
            console.log(`Current status: ${status}`);
            if (status === 'RUNNING') {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            attempts++;
        }
        
        if (status === 'COMPLETED') {
            console.log('Reconciliation completed! Checking results in reconciliation_results_2a...');
            const results = await knex('reconciliation_results_2a').where({ recon_run_id: runId });
            console.log(`Found ${results.length} results in reconciliation_results_2a.`);
            
            if (results.length > 0) {
                console.log('SUCCESS: Data isolation verified. Results are in the correct table.');
            } else {
                console.log('WARNING: Reconciliation completed but no results found. This might be due to lack of matching data in the DB.');
            }
            
            // 3. Double check the 2B table is empty for this run
            const results2b = await knex('reconciliation_results').where({ recon_run_id: runId });
            if (results2b.length === 0) {
                console.log('SUCCESS: No results leaked into reconciliation_results.');
            } else {
                console.error('FAILURE: Results leaked into reconciliation_results!');
            }
        } else {
            console.error(`Reconciliation failed or timed out with status: ${status}`);
        }
        
    } catch (error) {
        console.error('Test failed with error:', error);
    } finally {
        await knex.destroy();
    }
}

testRecon();
