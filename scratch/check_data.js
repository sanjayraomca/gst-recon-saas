const knex = require('../services/shared/src/db/connection');

async function checkData() {
    try {
        const workspaceUsers = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .select('workspaces.tenant_id', 'workspace_users.user_id');
            
        console.log('Workspace Users mapping:', workspaceUsers);
        
        const tenants = await knex('tenants').select('id', 'legal_name', 'owner_user_id');
        console.log('Tenants:', tenants);
        
        const totalUsers = await knex('users').count('id as count').first();
        console.log('Total users in DB:', totalUsers.count);
        
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkData();
