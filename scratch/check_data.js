const knex = require('knex')({
    client: 'postgresql',
    connection: {
        host: 'localhost',
        user: 'postgres',
        password: 'password',
        database: 'gst_recon_saas'
    }
});

async function checkData() {
    try {
        const workspace = await knex('workspaces').first();
        console.log('--- Workspace Sample ---');
        console.log(JSON.stringify(workspace, null, 2));

        const user = await knex('users').first();
        console.log('\n--- User Sample ---');
        console.log(JSON.stringify(user, null, 2));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkData();
