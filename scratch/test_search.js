require('dotenv').config({ path: '../.env' });
const knex = require('../services/shared/src/db/connection');
const { searchGstin } = require('../services/workspace-service/src/connectors/gstnSyncController');

async function run() {
    try {
        const workspace = await knex('workspaces').first();
        if (!workspace) {
            console.log("No workspace found");
            process.exit(1);
        }

        const req = {
            workspace_id: workspace.id,
            query: { gstin: '33AAGCB1286Q1ZB' }
        };

        const res = {
            status: function(code) {
                this.statusCode = code;
                return this;
            },
            json: function(data) {
                console.log("Response:", JSON.stringify(data, null, 2));
            }
        };

        console.log("Testing searchGstin with workspace:", workspace.id);
        await searchGstin(req, res);

    } catch (e) {
        console.error(e);
    } finally {
        knex.destroy();
    }
}

run();
