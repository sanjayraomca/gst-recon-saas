const { v4: uuidv4 } = require('uuid');

exports.up = async function (knex) {
    // 1. Add gstin_id to workspaces
    await knex.schema.alterTable('workspaces', function (table) {
        table.uuid('gstin_id').references('id').inTable('gstin_master');
    });

    // 2. Populate workspaces.gstin_id from gstin_master
    await knex.raw(`
        UPDATE workspaces w
        SET gstin_id = g.id
        FROM gstin_master g
        WHERE g.workspace_id = w.id
    `);

    // 3. Drop unique constraint and column manually using raw SQL to avoid knex naming issues
    await knex.raw('ALTER TABLE gstin_master DROP CONSTRAINT IF EXISTS "gstin_master_workspace_id_gstin_key"');

    // Drop workspace_id column
    await knex.schema.alterTable('gstin_master', function (table) {
        table.dropColumn('workspace_id');
        // Add unique constraint on gstin
        table.unique('gstin');
    });
};

exports.down = async function (knex) {
    if (await knex.schema.hasColumn('workspaces', 'gstin_id')) {
        await knex.schema.alterTable('workspaces', function (table) {
            table.dropColumn('gstin_id');
        });
    }

    await knex.schema.alterTable('gstin_master', function (table) {
        table.dropUnique('gstin');
        table.uuid('workspace_id');
    });
};
