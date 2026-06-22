const knex = require('../src/db/connection');

async function test() {
  try {
    const res = await knex('workspaces').select('id', 'tenant_id', 'gstn', 'name');
    console.log(res);
  } catch (err) {
    console.error(err);
  } finally {
    await knex.destroy();
  }
}

test();
