const knex = require('../db/connection');

/**
 * Specialized Audit Logger for Data-Level Changes
 * Logs into the 'audit_log' table as defined in the schema.
 */
const logAudit = async ({
    tableName,
    recordId,
    action,
    oldValue,
    newValue,
    modifiedBy,
    trx = null
}) => {
    try {
        const executor = trx || knex;
        
        await executor('audit_log').insert({
            table_name: tableName,
            record_id: recordId,
            action: action || 'UPDATE',
            old_value: oldValue ? JSON.stringify(oldValue) : null,
            new_value: newValue ? JSON.stringify(newValue) : null,
            modified_by: modifiedBy || 'SYSTEM',
            modified_at: new Date()
        });
    } catch (error) {
        console.error('[AuditLogger] Failed to log to audit_log table:', error.message);
    }
};

module.exports = { logAudit };
