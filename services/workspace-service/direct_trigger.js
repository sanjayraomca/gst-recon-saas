const ReconciliationModel = require('./src/models/reconciliationModel');

async function runTest() {
  const workspaceId = '8d84c307-e611-40c7-9d1d-3c04fce101fc';
  const runData = {
    gstin_id: 'f46267d7-012a-4cca-808e-159111bc0d3d',
    period: '042025',
    run_type: 'GSTR2A_VS_GSTR2B',
    run_mode: 'MANUAL'
  };

  console.log('Triggering Reconciliation Run...');
  try {
    const runId = await ReconciliationModel.createRun(workspaceId, runData);
    console.log(`Successfully triggered run. ID: ${runId}`);
    
    // Wait a bit for processing
    console.log('Waiting 5 seconds for matching engine to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    process.exit(0);
  } catch (err) {
    console.error('Failed to trigger run:', err);
    process.exit(1);
  }
}

runTest();
