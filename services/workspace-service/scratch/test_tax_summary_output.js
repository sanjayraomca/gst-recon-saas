const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from main .env
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Set DB name, host, and port for the local script connection (host should be localhost since we run from host machine, port is 5435)
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5435';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';

const knex = require('../../shared/src/db/connection');
const ReconciliationModel = require('../src/models/reconciliationModel');
const Reconciliation2AModel = require('../src/models/reconciliation2AModel');

async function verify() {
  try {
    console.log('Fetching workspace runs with results...');
    const runs = await knex('reconciliation_runs as rr')
      .join('reconciliation_results as rres', 'rr.id', 'rres.recon_run_id')
      .select('rr.id', 'rr.workspace_id', 'rr.run_type')
      .groupBy('rr.id', 'rr.workspace_id', 'rr.run_type')
      .limit(5);
    if (runs.length === 0) {
      console.log('No reconciliation runs found in the database. Seeding/reconciliation might be needed.');
      return;
    }

    for (const run of runs) {
      console.log(`\nTesting Tax Summary for Run: ${run.id} (Workspace: ${run.workspace_id}, Type: ${run.run_type})`);
      let summary;
      if (run.run_type === 'PURCHASE_2B') {
        summary = await ReconciliationModel.getRunTaxSummary(run.workspace_id, run.id, {});
      } else if (run.run_type === 'PURCHASE_2A') {
        summary = await Reconciliation2AModel.getRunTaxSummary(run.workspace_id, run.id, {});
      } else {
        console.log(`Skipping unsupported run type: ${run.run_type}`);
        continue;
      }

      const periods = summary.periods || [];
      console.log(`Found ${periods.length} periods in summary.`);
      
      let foundInvoice = false;
      for (const period of periods) {
        for (const cat of (period.categories || [])) {
          if (cat.invoices && cat.invoices.length > 0) {
            console.log(`Example invoice in category ${cat.category}:`);
            const inv = cat.invoices[0];
            console.log(JSON.stringify(inv, null, 2));
            foundInvoice = true;
            break;
          }
        }
        if (foundInvoice) break;
      }
      if (!foundInvoice) {
        console.log('No invoices found in tax summary periods.');
      }
    }
  } catch (err) {
    console.error('Error verifying tax summary:', err);
  } finally {
    await knex.destroy();
  }
}

verify();
