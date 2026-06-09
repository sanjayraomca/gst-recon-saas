const path = require('path');
const workspaceDir = '/home/tanvir/Desktop/gsttool_project/gst-recon-saas';
module.paths.push(path.join(workspaceDir, 'services/workspace-service/node_modules'));

require('dotenv').config({ path: path.join(workspaceDir, '.env') });
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB;
process.env.DB_USER = process.env.POSTGRES_MAIN_USER;
process.env.DB_PORT = 5435;

const knex = require(path.join(workspaceDir, 'services/shared/src/db/connection'));

async function run() {
    try {
        const rows = await knex('sales_invoices')
            .select('invoice_number', 'place_of_supply', 'customer_gstin')
            .limit(10);
        console.table(rows);
    } catch (err) {
        console.error(err);
    } finally {
        await knex.destroy();
    }
}
run();
