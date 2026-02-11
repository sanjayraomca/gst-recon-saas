
exports.up = async function (knex) {
    await knex.schema.alterTable('reconciliation_results', function (table) {
        table.dropForeign(['gstr2b_invoice_id'], 'reconciliation_results_gstr2b_invoice_id_fkey');
    });
};

exports.down = async function (knex) {
    // Re-add FK? Hard to do if gstr2b_invoices is not the source anymore.
    // Leaving empty as this is a forward-only structural change.
};
