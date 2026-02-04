const knex = require('../../../shared/src/db/connection');

class TenantModel {
    async create(tenantData) {
        const [tenant] = await knex('tenants')
            .insert(tenantData)
            .returning('*');
        return tenant;
    }

    async findById(id) {
        return await knex('tenants')
            .where({ id })
            .whereNull('deleted_at')
            .first();
    }

    async findByCode(tenantCode) {
        return await knex('tenants')
            .where({ tenant_code: tenantCode })
            .whereNull('deleted_at')
            .first();
    }

    async findAll(filters = {}, pagination = {}) {
        let query = knex('tenants')
            .whereNull('deleted_at');

        // Apply filters
        if (filters.subscription_status) {
            query = query.where('subscription_status', filters.subscription_status);
        }
        if (filters.subscription_plan) {
            query = query.where('subscription_plan', filters.subscription_plan);
        }
        if (filters.search) {
            query = query.where(function () {
                this.where('legal_name', 'ilike', `%${filters.search}%`)
                    .orWhere('trading_name', 'ilike', `%${filters.search}%`)
                    .orWhere('tenant_code', 'ilike', `%${filters.search}%`);
            });
        }

        // Apply pagination
        const page = parseInt(pagination.page) || 1;
        const limit = parseInt(pagination.limit) || 20;
        const offset = (page - 1) * limit;

        const [countResult] = await knex('tenants')
            .whereNull('deleted_at')
            .count('* as count');
        const total = parseInt(countResult.count);

        const tenants = await query
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);

        return {
            data: tenants,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async update(id, updates) {
        const [tenant] = await knex('tenants')
            .where({ id })
            .whereNull('deleted_at')
            .update({
                ...updates,
                updated_at: new Date()
            })
            .returning('*');
        return tenant;
    }

    async softDelete(id) {
        const [tenant] = await knex('tenants')
            .where({ id })
            .whereNull('deleted_at')
            .update({
                deleted_at: new Date(),
                updated_at: new Date()
            })
            .returning('*');
        return tenant;
    }

    async hardDelete(id) {
        return await knex('tenants')
            .where({ id })
            .delete();
    }

    async findWithWorkspaces(id) {
        const tenant = await this.findById(id);
        if (!tenant) return null;

        const workspaces = await knex('tenant_workspaces as tw')
            .join('workspaces as w', 'tw.workspace_id', 'w.id')
            .where('tw.tenant_id', id)
            .whereNull('w.deleted_at')
            .select(
                'w.*',
                'tw.access_type',
                'tw.invitation_status'
            );

        return {
            ...tenant,
            workspaces
        };
    }
}

module.exports = new TenantModel();
