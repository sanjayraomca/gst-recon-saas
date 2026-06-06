require('dotenv').config({ path: './.env' });
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB;
process.env.DB_USER = process.env.POSTGRES_MAIN_USER;
process.env.DB_PORT = 5435;
const knex = require('../services/shared/src/db/connection');

async function test() {
    try {
        const users = await knex('users').select('*');
        console.log('Users:', users.map(u => ({ id: u.id, email: u.email, tenant_id: u.tenant_id })));
        if (users.length > 0) {
            console.log('User keys:', Object.keys(users[0]));
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
test();
