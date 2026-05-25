const knex = require('../services/shared/src/db/connection');

async function check() {
    try {
        const workspaces = await knex('workspaces')
            .select('id', 'name', 'workspace_code', 'settings');
        console.log('Workspaces and their settings:');
        console.log(JSON.stringify(workspaces, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

check();
