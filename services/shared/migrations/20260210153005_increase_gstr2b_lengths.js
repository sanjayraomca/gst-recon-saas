exports.up = function (knex) {
    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        table.string('supply_type', 100).alter();
        table.string('itc_availability', 50).alter();
        table.string('itc_blocked_reason', 500).alter();
        table.string('itc_blocked_section', 100).alter();
        table.string('invoice_type', 100).alter();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        table.string('supply_type', 20).alter();
        table.string('itc_availability', 20).alter();
        table.string('itc_blocked_reason', 200).alter();
        table.string('itc_blocked_section', 50).alter();
        table.string('invoice_type', 50).alter();
    });
};
