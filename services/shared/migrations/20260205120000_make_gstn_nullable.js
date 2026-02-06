exports.up = function (knex) {
    return knex.schema.alterTable('workspaces', function (table) {
        table.string('gstn', 20).nullable().alter();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('workspaces', function (table) {
        table.string('gstn', 20).notNullable().alter();
    });
};
