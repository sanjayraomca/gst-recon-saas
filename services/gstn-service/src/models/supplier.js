const knex = require('../../../shared/src/db/connection');

class Supplier {
    static get tableName() {
        return 'supplier_master';
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
        if (filters.supplier_type) query.where('supplier_type', filters.supplier_type);
        if (filters.risk_category) query.where('risk_category', filters.risk_category);

        if (filters.search) {
            query.where(builder => {
                builder.where('supplier_name', 'ilike', `%${filters.search}%`)
                    .orWhere('supplier_code', 'ilike', `%${filters.search}%`)
                    .orWhere('gstin', 'ilike', `%${filters.search}%`);
            });
        }

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

module.exports = Supplier;
