const db = require('../../../shared/src/db/connection');

class NoticeModel {
    static get tableName() {
        return 'gst_notices';
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
        if (filters.gstin_id) query.where('gstin_id', filters.gstin_id);
        if (filters.status) query.where('status', filters.status);
        if (filters.notice_type) query.where('notice_type', filters.notice_type);
        if (filters.date_from) query.where('notice_date', '>=', filters.date_from);
        if (filters.date_to) query.where('notice_date', '<=', filters.date_to);

        query.orderBy('notice_date', 'desc');

        if (pagination.page && pagination.page_size) {
            const offset = (pagination.page - 1) * pagination.page_size;
            query.limit(pagination.page_size).offset(offset);
        }

        return query;
    }

    static async findById(id) {
        return db(this.tableName).where({ id }).first();
    }

    static async update(id, data) {
        const [updated] = await db(this.tableName)
            .where({ id })
            .update(data)
            .returning('*');
        return updated;
    }
}

module.exports = NoticeModel;
