


exports.up = async function (knex) {
    const hasCompliance = await knex.schema.hasColumn('workspaces', 'compliance_score');
    if (!hasCompliance) {
        await knex.schema.table('workspaces', table => {
            table.integer('compliance_score').defaultTo(85);
        });
    }

    const hasActivity = await knex.schema.hasColumn('workspaces', 'last_activity');
    if (!hasActivity) {
        await knex.schema.table('workspaces', table => {
            table.timestamp('last_activity').defaultTo(knex.fn.now());
        });
    }
};

exports.down = async function (knex) {
    const hasCompliance = await knex.schema.hasColumn('workspaces', 'compliance_score');
    if (hasCompliance) {
        await knex.schema.table('workspaces', table => {
            table.dropColumn('compliance_score');
        });
    }

    const hasActivity = await knex.schema.hasColumn('workspaces', 'last_activity');
    if (hasActivity) {
        await knex.schema.table('workspaces', table => {
            table.dropColumn('last_activity');
        });
    }
};
