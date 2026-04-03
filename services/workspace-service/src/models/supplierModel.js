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
                    COALESCE(scm.state, w.state, 'Other') as state_name,
                    sm.is_active,
                    sm.created_at,
                    sm.updated_at
                FROM supplier_master sm
                LEFT JOIN state_code_master scm ON scm.code = SUBSTRING(sm.gstin, 1, 2)
                LEFT JOIN workspaces w ON w.id = sm.workspace_id
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
                .where(function () {
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

    /**
     * Get suppliers with their last filing status from GSTR-2A data
     */
    static async getFilingStatusListing(workspaceId, filters = {}) {
        const { search, page = 1, limit = 10 } = filters;
        const offset = (page - 1) * limit;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const rawQuery = `
                WITH latest_filing AS (
                    SELECT DISTINCT ON (supplier_gstin)
                        supplier_gstin as gstin,
                        filing_period,
                        return_period,
                        filing_date,
                        document_date,
                        supplier_name as name,
                        workspace_id
                    FROM normalized_gstr2b_invoices
                    WHERE workspace_id = ?::uuid
                    ORDER BY supplier_gstin, filing_date DESC NULLS LAST, document_date DESC NULLS LAST
                )
                SELECT 
                    COALESCE(sm.id, gen_random_uuid()) as id,
                    lf.gstin,
                    COALESCE(lf.name, sm.supplier_name, 'Unknown') as name,
                    lf.filing_period as last_period,
                    lf.return_period as last_return_period,
                    lf.filing_date as last_date,
                    COALESCE(sm.is_active, true) as is_active
                FROM latest_filing lf
                LEFT JOIN supplier_master sm ON sm.gstin = lf.gstin AND sm.workspace_id = lf.workspace_id
                WHERE (lf.gstin ILIKE ? OR lf.name ILIKE ?)
                ORDER BY name ASC NULLS LAST
                LIMIT ? OFFSET ?
            `;

            const params = [
                workspaceId, // GSTR-2B source
                searchPattern,
                searchPattern,
                limit,
                offset
            ];

            const result = await knex.raw(rawQuery, params);
            return result.rows || [];
        } catch (error) {
            console.error('[SupplierModel] Error in getFilingStatusListing:', error);
            throw error;
        }
    }

    /**
     * Get total count for unified filing status listing
     */
    static async countFilingStatusListing(workspaceId, filters = {}) {
        const { search } = filters;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const rawQuery = `
                WITH combined_filings AS (
                    SELECT supplier_gstin, workspace_id, supplier_name FROM normalized_gstr2a_invoices WHERE workspace_id = ?::uuid
                    UNION ALL
                    SELECT supplier_gstin, workspace_id, supplier_name FROM normalized_gstr2b_invoices WHERE workspace_id = ?::uuid
                ),
                all_suppliers AS (
                    SELECT gstin FROM supplier_master WHERE workspace_id = ?::uuid
                    UNION
                    SELECT supplier_gstin FROM combined_filings WHERE workspace_id = ?::uuid
                )
                SELECT COUNT(*) as total FROM all_suppliers;
            `;

            const result = await knex.raw(rawQuery, [workspaceId, workspaceId, workspaceId, workspaceId]);
            return parseInt(result.rows[0].total) || 0;
        } catch (error) {
            console.error('[SupplierModel] Error in countFilingStatusListing:', error);
            throw error;
        }
    }

    /**
     * Get month-wise filing history for a specific supplier
     */
    static async getFilingHistory(workspaceId, gstin) {
        try {
            const rawQuery = `
                WITH combined_history AS (
                    SELECT return_period, filing_date, filing_period, workspace_id, supplier_gstin FROM normalized_gstr2b_invoices
                )
                SELECT 
                    return_period as period,
                    MAX(filing_date) as filing_date,
                    MAX(filing_period) as filing_period,
                    COUNT(*) as invoice_count
                FROM combined_history
                WHERE workspace_id = ?::uuid
                AND supplier_gstin = ?
                GROUP BY return_period
                ORDER BY RIGHT(return_period, 4) DESC, LEFT(return_period, 2) DESC
            `;

            const result = await knex.raw(rawQuery, [workspaceId, gstin]);
            return result.rows || [];
        } catch (error) {
            console.error('[SupplierModel] Error in getFilingHistory:', error);
            throw error;
        }
    }
}

module.exports = SupplierModel;
