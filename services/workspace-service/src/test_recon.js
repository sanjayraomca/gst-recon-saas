const knex = require('./src/db/connection');
const ReconciliationModel = require('./src/models/reconciliationModel');

async function testRecon() {
    try {
        // Find existing workspace
        const workspace = await knex('workspaces').first();
        if (!workspace) throw new Error("No workspaces found");

        const purchase = await knex('purchase_vouchers').first();
        if (!purchase) throw new Error("No purchase vouchers found");

        console.log(`Using Workspace: ${workspace.id}`);
        console.log(`Using Supplier: ${purchase.supplier_gstin}`);

        let month = 4, year = 2024;
        if (purchase.supplier_invoice_date) {
            const date = new Date(purchase.supplier_invoice_date);
            month = date.getMonth() + 1;
            year = date.getFullYear();
        }

        const periodStr = `${month.toString().padStart(2, '0')}${year}`;
        console.log(`Using Period: ${periodStr}`);

        // ensure tax period exists
        let period = await knex('tax_periods').where({ month, year }).first();
        if (!period) {
            console.log("Creating tax period for testing...");
            [period] = await knex('tax_periods').insert({
                id: knex.raw('uuid_generate_v4()'),
                tenant_id: workspace.tenant_id,
                period_name: `${month.toString().padStart(2, '0')}-${year}`,
                month, year,
                start_date: `${year}-${month.toString().padStart(2, '0')}-01`,
                end_date: `${year}-${month.toString().padStart(2, '0')}-28`,
                financial_year_id: (await knex('financial_years').first().then(r => r ? r.id : null)) || null
            }).returning('*');
        }

        const runData = {
            gstin_id: knex.raw('uuid_generate_v4()'), // dummy, query doesn't use it directly if handled well
            period: periodStr,
            tenant_id: workspace.tenant_id
        };

        const runId = await ReconciliationModel.createRun(workspace.id, runData);
        console.log(`Reconciliation Run Created: ${runId}`);

        const results = await ReconciliationModel.getRunResults(workspace.id, runId);
        console.log(`Number of results matched: ${results.length}`);

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        await knex.destroy();
    }
}

testRecon();
