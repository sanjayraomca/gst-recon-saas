const db = require('../../../shared/src/db/connection');

class VendorCommModel {
    static get tableName() {
        return 'vendor_communications';
    }

    static async create(data) {
        const [record] = await db(this.tableName)
            .insert(data)
            .returning('*');
        return record;
    }

    static async findAll(filters = {}, pagination = {}) {
        const query = db(this.tableName);

        if (filters.workspace_id) query.where('workspace_id', filters.workspace_id);
        if (filters.supplier_id) query.where('supplier_id', filters.supplier_id);
        if (filters.status) query.where('status', filters.status);
        if (filters.communication_type) query.where('communication_type', filters.communication_type);
        if (filters.requires_follow_up) query.where('requires_follow_up', filters.requires_follow_up);

        query.orderBy('created_at', 'desc');

        if (pagination.page && pagination.page_size) {
            const offset = (pagination.page - 1) * pagination.page_size;
            query.limit(pagination.page_size).offset(offset);
        }

        return query;
    }

    static async findById(id) {
        return db(this.tableName).where({ id }).first();
    }
}

module.exports = VendorCommModel;
