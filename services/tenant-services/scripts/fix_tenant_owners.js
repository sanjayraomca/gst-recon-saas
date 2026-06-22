const knex = require('../../shared/src/db/connection');

async function fixTenantOwners() {
    console.log('--- Starting Tenant Owner Fix ---');
    try {
        // Find users who have a tenant_id but the tenant has no owner_user_id
        const orphans = await knex('users')
            .join('tenants', 'users.tenant_id', 'tenants.id')
            .whereNull('tenants.owner_user_id')
            .select('users.id as user_id', 'users.email', 'tenants.id as tenant_id', 'tenants.legal_name');

        console.log(`Found ${orphans.length} tenants with missing owner_user_id.`);

        for (const orphan of orphans) {
            console.log(`Fixing tenant ${orphan.tenant_id} (${orphan.legal_name}) for user ${orphan.email}`);
            await knex('tenants')
                .where({ id: orphan.tenant_id })
                .update({ owner_user_id: orphan.user_id });
        }

        console.log('--- Tenant Owner Fix Completed ---');
    } catch (error) {
        console.error('Error during fix:', error);
    } finally {
        process.exit(0);
    }
}

fixTenantOwners();
