const knex = require('./services/shared/src/db/connection');

async function checkData() {
    try {
        console.log('Querying v_gstr_listing for import_type distribution...');
        const stats = await knex.raw(`
            SELECT import_type, COUNT(*) as count 
            FROM v_gstr_listing 
            GROUP BY import_type
        `);
        console.log('Import Type Stats:', stats.rows);

        const workspace = await knex('workspaces').first();
        if (workspace) {
            console.log(`\nChecking data for Workspace ID: ${workspace.id}`);
            const wsStats = await knex.raw(`
                SELECT import_type, COUNT(*) as count 
                FROM v_gstr_listing 
                WHERE workspace_id = ?
                GROUP BY import_type
            `, [workspace.id]);
            console.log('Workspace Stats:', wsStats.rows);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkData();
