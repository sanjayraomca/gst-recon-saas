const knex = require('../shared/src/db/connection');
async function run() {
    const res = await knex('tax_periods').limit(5);
    console.log("Tax periods:", res);
    process.exit(0);
}
run();
