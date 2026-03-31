const knex = require('./services/workspace-service/src/../../shared/src/db/connection');

async function applyMigration() {
  try {
    console.log('Adding gstr2a_source_id to reconciliation_results...');
    await knex.schema.alterTable('reconciliation_results', table => {
      table.uuid('gstr2a_source_id').references('id').inTable('normalized_gstr2a_invoices').nullable();
    });
    console.log('Migration successful!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

applyMigration();
