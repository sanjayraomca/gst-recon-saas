const knex = require('./services/shared/src/db/connection');

async function migrate() {
    try {
        const hasToken = await knex.schema.hasColumn('users', 'invitation_token');
        if (!hasToken) {
            await knex.schema.table('users', function (table) {
                table.string('invitation_token').nullable();
                table.timestamp('invitation_expires_at').nullable();
            });
            console.log('Added invitation_token and invitation_expires_at columns');
        } else {
            console.log('Columns already exist');
        }
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await knex.destroy();
    }
}

migrate();
