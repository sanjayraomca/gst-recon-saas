
exports.up = async function (knex) {
    await knex.schema.alterTable('workspaces', function (table) {
        // Drop global unique constraint
        table.dropUnique(['workspace_code'], 'workspaces_workspace_code_key');

        // Add composite unique constraint (per tenant)
        table.unique(['tenant_id', 'workspace_code'], 'workspaces_tenant_id_workspace_code_key');
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('workspaces', function (table) {
        table.dropUnique(['tenant_id', 'workspace_code'], 'workspaces_tenant_id_workspace_code_key');
        table.unique('workspace_code', 'workspaces_workspace_code_key');
    });
};
