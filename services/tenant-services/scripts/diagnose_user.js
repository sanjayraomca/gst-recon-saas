const knex = require('../../shared/src/db/connection');

async function diagnoseUser() {
    const email = 'bk@yopmail.com';
    console.log(`--- Diagnosing user: ${email} ---`);
    try {
        const user = await knex('users').where({ email }).first();
        if (!user) {
            console.log('User not found in local DB.');
            return;
        }
        console.log('User data:', JSON.stringify(user, null, 2));

        const ownedTenants = await knex('tenants').where({ owner_user_id: user.id });
        console.log('Owned Tenants:', JSON.stringify(ownedTenants, null, 2));

        const workspaceUsers = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspace_users.user_id', user.id)
            .select('workspaces.id', 'workspaces.name', 'workspaces.tenant_id', 'workspace_users.role');
        console.log('Workspace Access:', JSON.stringify(workspaceUsers, null, 2));

    } catch (error) {
        console.error('Error during diagnosis:', error);
    } finally {
        process.exit(0);
    }
}

diagnoseUser();
