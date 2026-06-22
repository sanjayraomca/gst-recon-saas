require('dotenv').config();
const knex = require('../services/shared/src/db/connection');

async function checkColumns() {
    try {
        const result = await knex('purchase_vouchers').columnInfo();
        console.log('Columns in purchase_vouchers:', Object.keys(result));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

checkColumns();
