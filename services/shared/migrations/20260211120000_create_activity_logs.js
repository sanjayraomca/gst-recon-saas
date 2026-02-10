
exports.up = function (knex) {
    return knex.schema.createTable('activity_logs', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.uuid('user_id').nullable(); // Nullable for system actions or if user is deleted
        table.uuid('tenant_id').nullable();
        table.uuid('workspace_id').nullable();
        table.string('action_type', 50).notNullable(); // LOGIN, CREATE, UPDATE, etc.
        table.string('entity_type', 50).notNullable(); // User, Organization, Invoice, etc.
        table.uuid('entity_id').nullable();
        table.jsonb('details').nullable(); // Flexible metadata
        table.string('ip_address', 45).nullable();
        table.text('user_agent').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Indexes for frequent search patterns
        table.index('user_id');
        table.index('tenant_id');
        table.index('workspace_id');
        table.index('action_type');
        table.index('created_at');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('activity_logs');
};
