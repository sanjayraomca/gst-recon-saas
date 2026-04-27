const fs = require('fs');
const path = require('path');
const knex = require('../../../shared/src/db/connection');

/**
 * SQL File Logger Utility
 * Intercepts Knex queries and writes them to a file in the 'queries' folder.
 * 
 * @param {string} transactionName - Base name for the file (e.g. 'GetRunResults')
 * @returns {Function} cleanup - Function to stop logging for this request
 */
function attachSqlFileLogger(transactionName) {
    const queriesDir = path.join(__dirname, '../queries');

    // Ensure directory exists (redundant but safe)
    if (!fs.existsSync(queriesDir)) {
        fs.mkdirSync(queriesDir, { recursive: true });
    }

    const queryHandler = (data) => {
        let sql = data.sql || '';
        const bindings = data.bindings || [];

        // Substitute placeholders for readability in the .sql file
        bindings.forEach((val, i) => {
            const placeholder = new RegExp(`\\$${i + 1}`, 'g');
            const safeVal = typeof val === 'string' ? `'${val}'` : (val === null ? 'NULL' : val);
            sql = sql.replace(placeholder, safeVal);

            if (sql.includes('?')) {
                sql = sql.replace('?', safeVal);
            }
        });

        // Add a semicolon if missing for valid SQL syntax
        if (!sql.trim().endsWith(';')) {
            sql = sql.trim() + ';';
        }

        const fileName = `${transactionName}.sql`;
        const filePath = path.join(queriesDir, fileName);

        const fileContent = `-- Transaction: ${transactionName}\n-- Last Executed at: ${new Date().toLocaleString()}\n-- Note: Query results include 'diff_' columns for parity with the dashboard UI.\n-- Bindings: ${JSON.stringify(bindings)}\n\n${sql}\n`;

        try {
            fs.writeFileSync(filePath, fileContent, 'utf8');
            console.log(`[SQL Logger] Updated file: ${fileName}`);
        } catch (err) {
            console.error('[SQL Logger] Failed to write SQL file:', err);
        }
    };

    knex.on('query', queryHandler);
    return () => knex.removeListener('query', queryHandler);
}

module.exports = { attachSqlFileLogger };
