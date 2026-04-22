const { ReconciliationModel } = require('./src/models/reconciliationModel');
const knex = require('knex')(require('./knexfile').development);

async function test() {
    const workspaceId = '2b6d0cb0-180a-4e00-832d-3838ffe0e9e1';
    const runId = '99c5a955-ae15-485f-b5e1-77e7f37d9b17';
    
    console.log('Testing ReconciliationModel.getRunResults directly...');
    const result = await ReconciliationModel.getRunResults(workspaceId, runId, { page: 1, page_size: 5 });
    
    if (result && result.data && result.data.length > 0) {
        console.log('RESULT_DATA_FOUND:', result.data.length, 'rows');
        console.log('FIRST_ROW_SNEAK_PEEK:', JSON.stringify({
            supplier_invoice_no: result.data[0].supplier_invoice_no,
            gstr_invoice_number: result.data[0].gstr_invoice_number,
            gstr_invoice_total: result.data[0].gstr_invoice_total,
            gstr2b_tax: result.data[0].gstr2b_tax
        }, null, 2));
    } else {
        console.log('NO_DATA_RETURNED');
    }
    process.exit(0);
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
