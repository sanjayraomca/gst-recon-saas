exports.up = function (knex) {
    return knex.schema.createTableIfNotExists('gstr2b_isd_credits', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
        table.uuid('period_id').notNullable().references('id').inTable('tax_periods').onDelete('CASCADE');

        table.string('isd_gstin', 15).notNullable();
        table.string('document_number', 100);
        table.date('document_date');
        table.decimal('document_value', 15, 2).defaultTo(0);

        table.decimal('igst_amount', 15, 2).defaultTo(0);
        table.decimal('cgst_amount', 15, 2).defaultTo(0);
        table.decimal('sgst_amount', 15, 2).defaultTo(0);
        table.decimal('cess_amount', 15, 2).defaultTo(0);

        table.string('itc_availability', 20);
        table.text('itc_reason');

        table.boolean('is_amended').defaultTo(false);
        table.boolean('is_rejected').defaultTo(false);
        table.text('rejection_reason');

        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Indexes
        table.index(['workspace_id', 'period_id'], 'idx_gstr2b_isd_workspace_period');
        table.index('isd_gstin', 'idx_gstr2b_isd_gstin');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('gstr2b_isd_credits');
};
