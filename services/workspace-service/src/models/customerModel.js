const knex = require('../../../shared/src/db/connection');

/**
 * Customer Model
 * Manages the persistent customer_master table.
 */
class CustomerModel {
    /**
     * Get paginated unique customers for a workspace
     */
    static async getAll(workspaceId, filters = {}) {
        const { search, page = 1, limit = 10 } = filters;
        const offset = (page - 1) * limit;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const rawQuery = `
                SELECT 
                    cm.id,
                    cm.gstin,
                    cm.customer_name as name,
                    cm.email,
                    cm.phone,
                    COALESCE(scm.state, 'Other') as state_name,
                    cm.is_active,
                    cm.created_at,
                    cm.updated_at
                FROM customer_master cm
                LEFT JOIN state_code_master scm ON scm.code = SUBSTRING(cm.gstin, 1, 2)
                WHERE cm.workspace_id = ?::uuid
                AND (cm.gstin ILIKE ? OR COALESCE(cm.customer_name, '') ILIKE ?)
                ORDER BY cm.customer_name ASC NULLS LAST
                LIMIT ? OFFSET ?
            `;

            const params = [
                workspaceId,
                searchPattern, 
                searchPattern,
                limit,
                offset
            ];

            const result = await knex.raw(rawQuery, params);
            return result.rows || [];
        } catch (error) {
            console.error('[CustomerModel] Error in getAll:', error);
            throw error;
        }
    }

    /**
     * Get total count for pagination
     */
    static async countAll(workspaceId, filters = {}) {
        const { search } = filters;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const result = await knex('customer_master')
                .where('workspace_id', workspaceId)
                .where(function() {
                    this.where('gstin', 'ILIKE', searchPattern)
                        .orWhere('customer_name', 'ILIKE', searchPattern);
                })
                .count('id as total');

            return parseInt(result[0].total) || 0;
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
