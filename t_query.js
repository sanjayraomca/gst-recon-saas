const knex = require('./services/shared/src/db/connection');

async function test() {
  const res = await knex('reconciliation_results')
    .leftJoin('normalized_gstr2b_invoices as gi', 'reconciliation_results.gstr2b_invoice_id', 'gi.id')
    .select('reconciliation_results.match_status', 'reconciliation_results.gstr2b_invoice_id', 'gi.taxable_value', 'gi.total_tax', 'gi.id')
    .whereNotNull('reconciliation_results.gstr2b_invoice_id')
    .limit(5);
  console.log(res);
  process.exit(0);
}

test();
