const knex = require('./services/workspace-service/src/../../shared/src/db/connection');

async function checkSchema() {
  try {
    const info = await knex('reconciliation_status').columnInfo();
    console.log('Columns in reconciliation_status:', Object.keys(info));
    process.exit(0);
  } catch (error) {
    console.error('Error fetching schema:', error);
    process.exit(1);
  }
}

checkSchema();
