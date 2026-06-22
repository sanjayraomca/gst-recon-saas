const knex = require('./services/shared/src/db/connection');
async function run() {
  try {
    const p = await knex('purchase_vouchers').select('supplier_invoice_date', 'workspace_id').orderBy('created_at', 'desc').limit(5);
    const g = await knex('normalized_gstr2b_invoices').select('document_date', 'workspace_id').orderBy('created_at', 'desc').limit(5);
    console.log('Purchase Dates:', p);
    console.log('GSTR2B Dates:', g);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
