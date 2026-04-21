const knex = require('../../../shared/src/db/connection');

/**
 * Customer Model
 * Manages the persistent customer_master table.
 */
class CustomerModel {
    /**
     * Build the base query with filters
     */
    static _buildBaseQuery(workspaceId, filters = {}) {
        const { search, customer_gstin, customer_name, state_codes, registration_status } = filters;
        
        let query = knex('customer_master as cm')
            .leftJoin('state_code_master as scm', 'scm.code', knex.raw('SUBSTRING(cm.gstin, 1, 2)'))
            .leftJoin('workspaces as w', 'w.id', 'cm.workspace_id')
            .where('cm.workspace_id', workspaceId);

        if (search) {
            const searchPattern = `%${search}%`;
            query.where(function () {
                this.where('cm.gstin', 'ILIKE', searchPattern)
                    .orWhere('cm.customer_name', 'ILIKE', searchPattern);
            });
        }

        if (customer_gstin) {
            const gstins = customer_gstin.split(',').map(s => s.trim()).filter(Boolean);
            if (gstins.length > 0) query.whereIn('cm.gstin', gstins);
        }

        if (customer_name) {
            const names = customer_name.split(',').map(s => s.trim()).filter(Boolean);
            if (names.length > 0) query.whereIn('cm.customer_name', names);
        }

        if (state_codes) {
            const states = state_codes.split(',').map(s => s.trim()).filter(Boolean);
            if (states.length > 0) {
                query.whereIn(knex.raw('SUBSTRING(cm.gstin, 1, 2)'), states);
            }
        }



        
        if (registration_status) {
            if (registration_status === 'registered') {
                query.whereRaw("COALESCE(cm.gstin, '') != '' AND cm.gstin NOT ILIKE '%UNREGISTERED%'");
            } else if (registration_status === 'unregistered') {
                query.whereRaw("COALESCE(cm.gstin, '') = '' OR cm.gstin ILIKE '%UNREGISTERED%'");
            }
        }

        return query;
    }

    /**
     * Get paginated unique customers for a workspace
     */
    static async getAll(workspaceId, filters = {}) {
        const { page = 1, limit = 10, sort_by, sort_order } = filters;
        const offset = (page - 1) * limit;

        try {
            const query = this._buildBaseQuery(workspaceId, filters);
            
            query.select([
                'cm.id',
                'cm.gstin',
                'cm.customer_name as name',
                'cm.email',
                'cm.phone',
                knex.raw("COALESCE(scm.state, w.state, 'Other') as state_name"),
                'cm.is_active',
                'cm.created_at',
                'cm.updated_at'
            ]);

            const orderDir = sort_order === 'desc' ? 'desc' : 'asc';
            if (sort_by) {
                const sortMap = {
                    'name': 'cm.customer_name',
                    'gstin': 'cm.gstin',
                    'state_name': knex.raw("COALESCE(scm.state, w.state, 'Other')")
                };
                const sortCol = sortMap[sort_by] || 'cm.customer_name';
                query.orderBy(sortCol, orderDir, 'last');
            } else {
                query.orderBy('cm.customer_name', 'asc', 'last');
            }

            query.limit(limit).offset(offset);

            const result = await query;
            return result || [];
        } catch (error) {
            console.error('[CustomerModel] Error in getAll:', error);
            throw error;
        }
    }

    /**
     * Get total count for pagination
     */
    static async countAll(workspaceId, filters = {}) {
        try {
            const query = this._buildBaseQuery(workspaceId, filters);
            const result = await query.count('cm.id as total').first();
            return parseInt(result?.total || 0);
        } catch (error) {
            console.error('[CustomerModel] Error in countAll:', error);
            throw error;
        }
    }

    /**
     * Update customer contact details
     */
    static async updateContact(id, data) {
        try {
            const { email, phone } = data;
            const updated = await knex('customer_master')
                .where('id', id)
                .update({
                    email: email || null,
                    phone: phone || null,
                    updated_at: knex.fn.now()
                })
                .returning('*');
            
            return updated[0];
        } catch (error) {
            console.error('[CustomerModel] Error in updateContact:', error);
            throw error;
        }
    }
}

module.exports = CustomerModel;
