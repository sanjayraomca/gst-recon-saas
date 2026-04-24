const knex = require('./services/shared/src/db/connection');

async function checkData() {
    try {
        const row = await knex('reconciliation_results').first();
        console.log('Sample Row:', row);
        
        const statusCount = await knex('reconciliation_status').count('id as count').first();
        console.log('Status Count:', statusCount);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkData();
