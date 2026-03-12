const knex = require('../shared/src/db/connection');

async function createTable() {
    try {
        console.log("Creating reconciliation_status table...");
        await knex.raw(`
            CREATE TABLE IF NOT EXISTS reconciliation_status (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workspace_id UUID NOT NULL,
                tenant_id UUID NOT NULL,
                gstr_data_id UUID,
                gstr_type VARCHAR(20),
                book_data_type VARCHAR(20),
                book_data_id UUID,
                book_line_item_id UUID,
                recon_status VARCHAR(50),
                status VARCHAR(20) DEFAULT 'Active',
                added_by UUID,
                added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by UUID,
                updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                extra_info JSONB
            );
        `);
        console.log("reconciliation_status table created successfully or already exists.");
    } catch (error) {
        console.error("Error creating reconciliation_status table:", error);
    } finally {
        await knex.destroy();
    }
}

createTable();
