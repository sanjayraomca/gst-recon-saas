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

async function test() {
    try {
        console.log('Testing BOOLEAN insertion with strings...');
        await knex.raw('CREATE TEMP TABLE test_bool (val BOOLEAN)');
        
        console.log('Attempting to insert "No"...');
        await knex.raw('INSERT INTO test_bool (val) VALUES (?)', ['No']);
        console.log('Inserted "No" successfully.');

        console.log('Attempting to insert "Yes"...');
        await knex.raw('INSERT INTO test_bool (val) VALUES (?)', ['Yes']);
        console.log('Inserted "Yes" successfully.');

    } catch (err) {
        console.error('Test failed:');
        console.error(err.message);
    } finally {
        await knex.destroy();
    }
}

test();
