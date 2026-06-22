const knex = require('./shared/src/db/connection');
async function test() {
    try {
        const columns = await knex('reconciliation_results').columnInfo();
        console.log(Object.keys(columns));
    } catch(e) {
        console.error(e);
    } finally {
        knex.destroy();
    }
}
test();
