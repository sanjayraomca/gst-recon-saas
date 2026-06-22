const knex = require('knex')({
    client: 'pg',
    connection: {
        host: 'localhost',
        user: 'gstadmin',
        password: 'GstAdmin123',
        database: 'gst_recon',
        port: 5432
    }
});

async function main() {
    try {
        const workspace = await knex('workspaces').first();
        if (workspace) {
            console.log('Valid Workspace found:');
            console.log('ID:', workspace.id);
            console.log('Tenant ID:', workspace.tenant_id);
            
            const gstin = await knex('gstin_master').where('id', workspace.gstin_id).first();
            console.log('GSTIN:', gstin ? gstin.gstin : 'None');
        } else {
            console.log('No workspace found.');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await knex.destroy();
    }
}

main();
