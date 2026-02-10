exports.up = async function (knex) {
    // Drop generated column first
    await knex.raw('ALTER TABLE gstr2b_invoices DROP COLUMN IF EXISTS invoice_year');

    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        table.date('invoice_date').nullable().alter();
        table.integer('invoice_year').nullable();
    });
};

exports.down = async function (knex) {
    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        table.dropColumn('invoice_year');
    }).then(() => {
        return knex.schema.alterTable('gstr2b_invoices', function (table) {
            table.date('invoice_date').notNullable().alter();
            table.specificType('invoice_year', 'integer GENERATED ALWAYS AS (EXTRACT(year FROM invoice_date)) STORED');
        });
    });
};
