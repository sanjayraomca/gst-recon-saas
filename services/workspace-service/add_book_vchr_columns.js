const knex = require('../shared/src/db/connection');

async function addColumns() {
    try {
        console.log("Adding book_vchr_date and book_vchr_no to purchase_vouchers table...");
        await knex.raw(`
            ALTER TABLE purchase_vouchers 
            ADD COLUMN IF NOT EXISTS book_vchr_date DATE,
            ADD COLUMN IF NOT EXISTS book_vchr_no VARCHAR(100);
        `);
        console.log("Columns added successfully or already exist.");
    } catch (error) {
        console.error("Error adding columns to purchase_vouchers:", error);
    } finally {
        await knex.destroy();
    }
}

addColumns();
