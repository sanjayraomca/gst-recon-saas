const knex = require('../../../shared/src/db/connection');

class TenantWorkspace {
    static get tableName() {
        return 'tenant_workspaces';
    }

    static async create(data) {
        const [record] = await knex(this.tableName)
            .insert(data)
            .returning('*');
        return record;
    }

    static async findByTenantId(tenantId) {
        return knex(this.tableName)
            .join('workspaces', 'tenant_workspaces.workspace_id', 'workspaces.id')
            .where({ 'tenant_workspaces.tenant_id': tenantId })
            .select('workspaces.*', 'tenant_workspaces.access_type');
    }
}

module.exports = TenantWorkspace;
