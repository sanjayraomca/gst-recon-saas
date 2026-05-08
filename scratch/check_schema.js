require('dotenv').config();
const knex = require('../services/shared/src/db/connection');

async function check() {
    try {
        const workspaceCols = await knex('workspaces').columnInfo();
        console.log('workspaces columns:', Object.keys(workspaceCols));
        
        const workspaceUsersCols = await knex('workspace_users').columnInfo();
        console.log('workspace_users columns:', Object.keys(workspaceUsersCols));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
