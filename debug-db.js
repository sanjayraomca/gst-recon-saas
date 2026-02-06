process.env.DB_HOST = 'localhost';
const knex = require('./services/shared/src/db/connection');

async function debug() {
    try {
        console.log('--- Debugging Data (v2) ---');

        // 1. Get User
        const email = 'gst@gmail.com';
        const user = await knex('users').where('email', email).first();
        console.log(`User: ${user?.full_name} (${user?.id})`);

        if (user) {
            // 2. Access via workspace_users
            const workspaceUsers = await knex('workspace_users').where('user_id', user.id);
            console.log(`\nLinked to ${workspaceUsers.length} workspaces via workspace_users:`);
            workspaceUsers.forEach(wu => console.log(` - WorkspaceID: ${wu.workspace_id} | Role: ${wu.role}`));

            const workspaceIds = workspaceUsers.map(wu => wu.workspace_id);
            if (workspaceIds.length > 0) {
                const workspaces = await knex('workspaces').whereIn('id', workspaceIds);
                workspaces.forEach(w => console.log(` - [${w.name}] (ID: ${w.id}) -> Tenant: ${w.tenant_id}`));
            }
        }

        // 3. Search for the problematic companies
        console.log('\n--- Checking ownership of A/B/C Companies ---');
        const problematic = await knex('workspaces').where('name', 'ilike', '%company%');
        problematic.forEach(w => {
            console.log(` - Workspace: ${w.name} | Tenant ID: ${w.tenant_id}`);
        });

        // 4. List all tenants
        console.log('\n--- All Tenants ---');
        const tenants = await knex('tenants').select('id', 'legal_name');
        tenants.forEach(t => console.log(` - Tenant: ${t.legal_name} (ID: ${t.id})`));

    } catch (err) {
        console.error(err);
    } finally {
        await knex.destroy();
    }
}

debug();
