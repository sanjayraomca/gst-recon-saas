const knex = require('../../../shared/src/db/connection');

/**
 * Supplier Model
 * Manages the persistent supplier_master table.
 */
class SupplierModel {
    /**
     * Get paginated unique suppliers for a workspace
     */
    static async getAll(workspaceId, filters = {}) {
        const { search, page = 1, limit = 10 } = filters;
        const offset = (page - 1) * limit;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const rawQuery = `
                SELECT 
                    sm.id,
                    sm.gstin,
                    sm.supplier_name as name,
                    sm.email,
                    sm.phone,
                    COALESCE(scm.state, 'Other') as state_name,
                    sm.is_active,
                    sm.created_at,
                    sm.updated_at
                FROM supplier_master sm
                LEFT JOIN state_code_master scm ON scm.code = SUBSTRING(sm.gstin, 1, 2)
                WHERE sm.workspace_id = ?::uuid
                AND (sm.gstin ILIKE ? OR COALESCE(sm.supplier_name, '') ILIKE ?)
                ORDER BY sm.supplier_name ASC NULLS LAST
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
            console.error('[SupplierModel] Error in getAll:', error);
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
            const result = await knex('supplier_master')
                .where('workspace_id', workspaceId)
                .where(function() {
                    this.where('gstin', 'ILIKE', searchPattern)
                        .orWhere('supplier_name', 'ILIKE', searchPattern);
                })
                .count('id as total');

            return parseInt(result[0].total) || 0;
        } catch (error) {
            console.error('[SupplierModel] Error in countAll:', error);
            throw error;
        }
    }

    /**
     * Update supplier contact details
     */
    static async updateContact(id, data) {
        try {
            const { email, phone } = data;
            const updated = await knex('supplier_master')
                .where('id', id)
                .update({
                    email: email || null,
                    phone: phone || null,
                    updated_at: knex.fn.now()
                })
                .returning('*');
            
            return updated[0];
        } catch (error) {
            console.error('[SupplierModel] Error in updateContact:', error);
            throw error;
        }
    }
}

module.exports = SupplierModel;
