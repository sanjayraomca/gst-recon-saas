require('dotenv').config();
const knex = require('../../shared/src/db/connection');
const ReconciliationModel = require('./models/reconciliationModel');

async function run() {
    const workspaceId = '48b0f3ce-eee3-487c-a7de-3d568ca13dd0';
    const gstinId = '5d1bec37-042c-46ae-8662-2d79c2217e16';
    
    // We pass 'ALL' so our fuzzy match tests the full logic like the frontend does.
    // wait, if we pass ALL we must have period_id = null ?
    const runData = {
        gstin_id: gstinId,
        period: 'ALL',
        run_type: 'PURCHASE_2B',
        run_mode: 'MANUAL'
    };
    try {
        console.log("Starting reconciliation run manually...");
        const runId = await ReconciliationModel.createRun(workspaceId, runData);
        console.log("Run created successfully:", runId);
        
        // Run synchronously to see all output!
        // We know createRun starts it but we can just await it directly if we do it here, wait, createRun doesn't return the promise of runMatchingTask.
        // Let's just give it a longer timeout to print everything.
        await new Promise(r => setTimeout(r, 20000));
        
    } catch (e) {
        console.error("Failed to run reconciliation:", e);
    }
    process.exit(0);
}

run();
