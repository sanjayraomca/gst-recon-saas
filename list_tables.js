const knex = require('./services/workspace-service/src/../../shared/src/db/connection');

async function listTables() {
    try {
        const res = await knex.raw("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
        console.log('Tables:', res.rows.map(r => r.table_name));
        process.exit(0);
    } catch (error) {
        console.error('Error listing tables:', error);
        process.exit(1);
    }
}

listTables();
