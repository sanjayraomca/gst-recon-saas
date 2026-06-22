const knex = require('./shared/src/db/connection');

async function checkSchema() {
    try {
        const columns = await knex('reconciliation_results').columnInfo();
        console.log('reconciliation_results columns:', Object.keys(columns));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
