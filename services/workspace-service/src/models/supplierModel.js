const knex = require('../../../shared/src/db/connection');

/**
 * Supplier Model
 * Aggregates unique suppliers from GSTR-2B and Purchase data
 */
class SupplierModel {
    /**
     * Get all unique suppliers for a workspace with search and state mapping
     */
    static async getAll(workspaceId, filters = {}) {
        const { search, invoice_date_from, invoice_date_to } = filters;

        const fromDate = invoice_date_from || '1900-01-01';
        const toDate = invoice_date_to || '2099-12-31';
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            const rawQuery = `
                WITH all_suppliers AS (
                    -- GSTR Data (Purchases)
                    SELECT supplier_gstin, supplier_name
                    FROM normalized_gstr2b_invoices
                    WHERE workspace_id = ?::uuid
                    AND document_date >= ? AND document_date <= ?
                    
                    UNION
                    
                    -- Book Data (Purchases)
                    SELECT supplier_gstin, supplier_name
                    FROM purchase_vouchers
                    WHERE workspace_id = ?::uuid
                    AND supplier_invoice_date >= ? AND supplier_invoice_date <= ?

                    UNION

                    -- Book Data (Sales)
                    SELECT customer_gstin, customer_name
                    FROM sales_invoices
                    WHERE workspace_id = ?::uuid
                    AND invoice_date >= ? AND invoice_date <= ?
                )
                SELECT 
                    s.supplier_gstin as gstin,
                    MIN(COALESCE(s.supplier_name, '—')) as name,
                    COALESCE(scm.state, 'Other') as state_name
                FROM all_suppliers s
                LEFT JOIN state_code_master scm ON scm.code = SUBSTRING(s.supplier_gstin, 1, 2)
                WHERE (s.supplier_gstin ILIKE ? OR COALESCE(s.supplier_name, '') ILIKE ?)
                GROUP BY s.supplier_gstin, scm.state
                ORDER BY name ASC NULLS LAST
            `;

            const params = [
                workspaceId, fromDate, toDate, 
                workspaceId, fromDate, toDate,
                workspaceId, fromDate, toDate,
                searchPattern, searchPattern
            ];

            const result = await knex.raw(rawQuery, params);
            return result.rows || [];
        } catch (error) {
            console.error('[SupplierModel] Error in getAll:', error);
            throw error;
        }
    }
}

module.exports = SupplierModel;
