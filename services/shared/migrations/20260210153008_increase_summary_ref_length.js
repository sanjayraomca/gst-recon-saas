exports.up = function (knex) {
    return knex.schema.alterTable('gstr2b_summaries', function (table) {
        table.string('gstr3b_table_ref', 100).alter();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('gstr2b_summaries', function (table) {
        table.string('gstr3b_table_ref', 20).alter();
    });
};
