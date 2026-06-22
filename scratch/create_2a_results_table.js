require('dotenv').config();
process.env.DB_NAME = process.env.DB_NAME || process.env.POSTGRES_MAIN_DB;
process.env.DB_USER = process.env.DB_USER || process.env.POSTGRES_MAIN_USER;
process.env.DB_PASSWORD = process.env.DB_PASSWORD || process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || 5435;

const knex = require('../services/shared/src/db/connection');

async function run() {
    try {
        console.log('Creating reconciliation_results_2a table...');
        await knex.schema.createTableIfNotExists('reconciliation_results_2a', (table) => {
            table.increments('id').primary();
            table.uuid('recon_run_id').notNullable().references('id').inTable('reconciliation_runs').onDelete('CASCADE');
            table.uuid('workspace_id').notNullable().references('id').inTable('workspaces');
            table.uuid('purchase_invoice_id').references('id').inTable('purchase_vouchers');
            table.uuid('gstr2a_invoice_id').references('id').inTable('normalized_gstr2a_invoices');
            table.uuid('gstr2a_source_id').references('id').inTable('normalized_gstr2a_invoices');
            table.uuid('gstr2b_invoice_id').references('id').inTable('normalized_gstr2b_invoices');
            
            table.string('match_status', 50).notNullable();
            table.decimal('match_score', 5, 2);
            table.string('match_confidence', 20);
            
            table.decimal('books_value', 15, 2);
            table.decimal('portal_value', 15, 2);
            table.decimal('variance_amount', 15, 2);
            
            table.string('itc_decision', 50);
            table.text('decision_reason');
            
            table.string('action_required', 50);
            table.string('action_priority', 20);
            table.string('action_status', 20);
            
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            
            table.string('matched_by', 20).defaultTo('RULE');
            table.decimal('ai_confidence_score', 5, 2);
            table.text('ai_match_reason');
        });

        console.log('Creating unique indexes...');
        await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_2a_purchase_inv ON reconciliation_results_2a (workspace_id, purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL');
        await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_results_2a_gstr2a_inv ON reconciliation_results_2a (workspace_id, gstr2a_invoice_id) WHERE gstr2a_invoice_id IS NOT NULL');

        console.log('Table created successfully!');
    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        await knex.destroy();
    }
}

run();
