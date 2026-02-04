exports.up = function (knex) {
    return knex.schema.createTable('saved_reports', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('workspace_id').notNullable().index();
        table.string('report_type').notNullable();
        table.string('report_name').notNullable();
        table.jsonb('report_config').nullable();
        table.jsonb('filters_applied').nullable();
        table.string('generation_status').defaultTo('CREATED'); // CREATED, PROCESSING, COMPLETED, FAILED
        table.timestamp('last_generated_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('saved_reports');
};
