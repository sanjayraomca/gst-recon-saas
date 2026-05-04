require('dotenv').config();
const knex = require('./services/shared/src/db/connection');
const ReconciliationModel = require('./services/workspace-service/src/models/reconciliationModel.js');

async function test() {
  try {
    const ws = await knex('workspaces').first();
    const run = await ReconciliationModel.getLatestRun(ws.id, 'PURCHASE_2B');
    if (!run) {
      console.log('No run found');
      process.exit(0);
    }
    const res = await ReconciliationModel.getRunResults(ws.id, run.id, { page: 1, page_size: 5 });
    console.log(JSON.stringify(res.data[0], null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

test();
