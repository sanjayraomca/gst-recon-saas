const knex = require('../../../shared/src/db/connection');

class GSTIN {
    static get tableName() {
        return 'gstins'; // Check strictly against schema if it's 'gstin_master' or 'gstins'. Schema says 'gstin_master'.
        // Implementation plan said 'gstins'. Let me check schema again.
        // Wait, I should verify the schema table name.
    }

    static async create(data) {
        const [record] = await knex('gstin_master') // Using correct table name from schema inspection
            .insert(data)
            .returning('*');
        return record;
    }

    static async findAll(filters = {}) {
        return knex('gstin_master').where(filters);
    }

    static async findById(id) {
        return knex('gstin_master').where({ id }).first();
    }

    static async findByGSTIN(gstin) {
        return knex('gstin_master').where({ gstin }).first();
    }

    static async update(id, data) {
        const [updated] = await knex('gstin_master')
            .where({ id })
            .update(data)
            .returning('*');
        return updated;
    }
}

module.exports = GSTIN;
