require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Map env vars
process.env.DB_HOST = process.env.POSTGRES_HOST || 'localhost';
process.env.DB_PORT = 5432;
process.env.DB_USER = process.env.POSTGRES_MAIN_USER || 'gstadmin';
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123';
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB || 'gst_recon';

const path = require('path');
const knex = require(path.join(__dirname, '../services/shared/src/db/connection'));

async function fixColumnSizes() {
    try {
        console.log(`Connecting to ${process.env.DB_NAME} as ${process.env.DB_USER}...`);
        
        console.log('Altering reconciliation_results.action_status to VARCHAR(50)...');
        await knex.raw('ALTER TABLE reconciliation_results ALTER COLUMN action_status TYPE VARCHAR(50)');
        
        console.log('Altering reconciliation_results_2a.action_status to VARCHAR(50)...');
        await knex.raw('ALTER TABLE reconciliation_results_2a ALTER COLUMN action_status TYPE VARCHAR(50)');
        
        console.log('Altering normalized_gstr2b_invoices.reconciliation_status to VARCHAR(50)...');
        await knex.raw('ALTER TABLE normalized_gstr2b_invoices ALTER COLUMN reconciliation_status TYPE VARCHAR(50)');
        
        console.log('Altering normalized_gstr2a_invoices.reconciliation_status to VARCHAR(50)...');
        await knex.raw('ALTER TABLE normalized_gstr2a_invoices ALTER COLUMN reconciliation_status TYPE VARCHAR(50)');

        console.log('Database columns updated successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error updating columns:', error.message);
        process.exit(1);
    }
}

fixColumnSizes();
