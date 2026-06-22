const knex = require('../services/shared/src/db/connection');

async function checkSchema() {
    try {
        const usersColumns = await knex('users').columnInfo();
        console.log('Users columns:', Object.keys(usersColumns));
        
        const tenantsColumns = await knex('tenants').columnInfo();
        console.log('Tenants columns:', Object.keys(tenantsColumns));
        
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkSchema();
