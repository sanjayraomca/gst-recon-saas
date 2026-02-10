exports.up = function (knex) {
    return knex.schema.alterTable('gstr2b_summaries', function (table) {
        table.text('gstr3b_table_ref').alter();
        table.text('summary_type').alter();
        table.text('part_type').alter();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('gstr2b_summaries', function (table) {
        table.string('gstr3b_table_ref', 100).alter();
        table.string('summary_type', 50).alter();
        table.string('part_type', 10).alter();
    });
};
