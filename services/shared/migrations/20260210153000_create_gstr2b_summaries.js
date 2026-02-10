exports.up = function (knex) {
    return knex.schema.createTableIfNotExists('gstr2b_summaries', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
        table.uuid('period_id').notNullable().references('id').inTable('tax_periods').onDelete('CASCADE');

        table.string('summary_type', 50).notNullable(); // 'ITC_AVAILABLE', 'ITC_NOT_AVAILABLE', 'ITC_REVERSAL', 'ITC_REJECTED'
        table.string('part_type', 10); // 'Part A', 'Part B'
        table.text('section_heading'); // 'All other ITC', 'IGST paid on import of goods', etc.
        table.string('gstr3b_table_ref', 20); // '4(A)(5)', '4(A)(1)', etc.

        table.decimal('igst_amount', 15, 2).defaultTo(0);
        table.decimal('cgst_amount', 15, 2).defaultTo(0);
        table.decimal('sgst_amount', 15, 2).defaultTo(0);
        table.decimal('cess_amount', 15, 2).defaultTo(0);

        table.text('advisory_text');
        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Indexes
        table.index(['workspace_id', 'period_id'], 'idx_gstr2b_summaries_workspace_period');
        table.index('summary_type', 'idx_gstr2b_summaries_type');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('gstr2b_summaries');
};
