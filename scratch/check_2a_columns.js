require('dotenv').config();
const knex = require('../services/shared/src/db/connection');

async function run() {
    try {
        console.log('Checking reconciliation_results_2a columns...');
        const resultsInfo = await knex('reconciliation_results_2a').columnInfo();
        console.log('Results Columns:', Object.keys(resultsInfo));
        
        console.log('\nChecking reconciliation_status_gst2a_vs_book columns...');
        const statusInfo = await knex('reconciliation_status_gst2a_vs_book').columnInfo();
        console.log('Status Columns:', Object.keys(statusInfo));
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await knex.destroy();
    }
}

run();
