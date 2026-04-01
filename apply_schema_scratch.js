const db = require('./services/shared/src/db/connection');
const fs = require('fs');
const path = require('path');

async function applySchema() {
    const sqlPath = path.join(__dirname, 'infra/postgres/reconciliation_status_gst2a_vs_book.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    try {
        console.log('Applying schema for reconciliation_status_gst2a_vs_book...');
        await db.raw(sql);
        console.log('Schema applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error applying schema:', error);
        process.exit(1);
    }
}

applySchema();
