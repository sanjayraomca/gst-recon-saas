const knex = require('../../../shared/src/db/connection');

class Workspace {
    static get tableName() {
        return 'workspaces';
    }

    static async create(data) {
        const [workspace] = await knex(this.tableName)
            .insert(data)
            .returning('*');
        return workspace;
    }

    static async findAll(filters = {}) {
        // Basic find all, will be enhanced for tenant filtering
        return knex(this.tableName).where(filters);
    }

    static async findById(id) {
        return knex(this.tableName).where({ id }).first();
    }

    static async findByCode(code) {
        return knex(this.tableName).where({ workspace_code: code }).first();
    }
}

module.exports = Workspace;
