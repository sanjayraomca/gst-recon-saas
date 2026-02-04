const knex = require('../../../shared/src/db/connection');

class Upload {
    static get tableName() {
        return 'file_uploads';
    }

    static async create(data) {
        const [record] = await knex(this.tableName)
            .insert(data)
            .returning('*');
        return record;
    }

    static async findAll(filters = {}, pagination = {}) {
        const query = knex(this.tableName);

        if (filters.workspace_id) query.where('workspace_id', filters.workspace_id);
        if (filters.gstin_id) query.where('gstin_id', filters.gstin_id);
        if (filters.status) query.where('status', filters.status);
        if (filters.upload_type) query.where('upload_type', filters.upload_type);

        query.orderBy('created_at', 'desc');

        if (pagination.page && pagination.page_size) {
            const offset = (pagination.page - 1) * pagination.page_size;
            query.limit(pagination.page_size).offset(offset);
        }

        return query;
    }

    static async findById(id) {
        return knex(this.tableName).where({ id }).first();
    }

    static async update(id, data) {
        const [updated] = await knex(this.tableName)
            .where({ id })
            .update(data)
            .returning('*');
        return updated;
    }
}

module.exports = Upload;
