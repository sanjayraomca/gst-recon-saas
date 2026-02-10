exports.up = function (knex) {
    return knex.schema.createTableIfNotExists('gstr2b_imports', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
        table.uuid('period_id').notNullable().references('id').inTable('tax_periods').onDelete('CASCADE');

        table.string('import_type', 20).notNullable(); // 'OVERSEAS', 'SEZ'
        table.string('supplier_gstin', 15); // Only for SEZ imports
        table.date('icegate_ref_date');
        table.string('port_code', 10);
        table.string('boe_number', 50); // Bill of Entry number
        table.date('boe_date');

        table.decimal('taxable_value', 15, 2).defaultTo(0);
        table.decimal('igst_amount', 15, 2).defaultTo(0);
        table.decimal('cess_amount', 15, 2).defaultTo(0);

        table.boolean('is_amended').defaultTo(false);
        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Indexes
        table.index(['workspace_id', 'period_id'], 'idx_gstr2b_imports_workspace_period');
        table.index('import_type', 'idx_gstr2b_imports_type');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('gstr2b_imports');
};
