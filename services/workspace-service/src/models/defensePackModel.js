const db = require('../../../shared/src/db/connection');

class DefensePackModel {
    static get tableName() {
        return 'notice_defense_packs';
    }

    static async create(data) {
        const [record] = await db(this.tableName)
            .insert(data)
            .returning('*');
        return record;
    }

    static async findByNoticeId(noticeId) {
        return db(this.tableName).where({ notice_id: noticeId }).first();
    }

    static async update(id, data) {
        const [updated] = await db(this.tableName)
            .where({ id })
            .update(data)
            .returning('*');
        return updated;
    }
}

module.exports = DefensePackModel;
