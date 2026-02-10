exports.up = async function (knex) {
    // Drop restrictive check constraints using raw SQL
    await knex.raw('ALTER TABLE gstr2b_invoices DROP CONSTRAINT IF EXISTS gstr2b_invoices_supply_type_check');
    await knex.raw('ALTER TABLE gstr2b_invoices DROP CONSTRAINT IF EXISTS gstr2b_invoices_itc_availability_check');
    await knex.raw('ALTER TABLE gstr2b_invoices DROP CONSTRAINT IF EXISTS gstr2b_invoices_document_type_check');
    await knex.raw('ALTER TABLE gstr2b_invoices DROP CONSTRAINT IF EXISTS gstr2b_invoices_match_status_check');

    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        // Make snapshot columns nullable
        table.uuid('snapshot_id').nullable().alter();
        table.timestamp('snapshot_captured_at', { useTz: true }).nullable().alter();

        // Increase place_of_supply_code and reverse_charge length
        table.string('place_of_supply_code', 100).alter();
        table.string('reverse_charge', 50).alter();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('gstr2b_invoices', function (table) {
        table.uuid('snapshot_id').notNullable().alter();
        table.timestamp('snapshot_captured_at', { useTz: true }).notNullable().alter();
        table.specificType('place_of_supply_code', 'char(2)').notNullable().alter();
    });
};
