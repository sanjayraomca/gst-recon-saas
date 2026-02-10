exports.up = function (knex) {
    return knex.schema.table('gstr2b_invoices', function (table) {
        table.string('eco_gstin', 15); // E-commerce operator GSTIN
    });
};

exports.down = function (knex) {
    return knex.schema.table('gstr2b_invoices', function (table) {
        table.dropColumn('eco_gstin');
    });
};
