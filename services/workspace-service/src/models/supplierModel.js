const knex = require('../../../shared/src/db/connection');

/**
 * Supplier Model
 * Manages the persistent supplier_master table.
 */
class SupplierModel {
    /**
     * Build the base query with filters
     */
    static _buildBaseQuery(workspaceId, filters = {}) {
        const { search, supplier_gstin, supplier_name, state_codes, registration_status } = filters;
        
        let query = knex('supplier_master as sm')
            .leftJoin('state_code_master as scm', 'scm.code', knex.raw('SUBSTRING(sm.gstin, 1, 2)'))
            .leftJoin('workspaces as w', 'w.id', 'sm.workspace_id')
            .where('sm.workspace_id', workspaceId);

        if (search) {
            const searchPattern = `%${search}%`;
            query.where(function () {
                this.where('sm.gstin', 'ILIKE', searchPattern)
                    .orWhere('sm.supplier_name', 'ILIKE', searchPattern);
            });
        }

        if (supplier_gstin) {
            const gstins = supplier_gstin.split(',').map(s => s.trim()).filter(Boolean);
            if (gstins.length > 0) query.whereIn('sm.gstin', gstins);
        }

        if (supplier_name) {
            const names = supplier_name.split(',').map(s => s.trim()).filter(Boolean);
            if (names.length > 0) query.whereIn('sm.supplier_name', names);
        }

        if (state_codes) {
            const states = state_codes.split(',').map(s => s.trim()).filter(Boolean);
            if (states.length > 0) {
                query.whereIn(knex.raw('SUBSTRING(sm.gstin, 1, 2)'), states);
            }
        }



        
        if (registration_status) {
            if (registration_status === 'registered') {
                query.whereRaw("COALESCE(sm.gstin, '') != '' AND sm.gstin NOT ILIKE '%UNREGISTERED%'");
            } else if (registration_status === 'unregistered') {
                query.whereRaw("COALESCE(sm.gstin, '') = '' OR sm.gstin ILIKE '%UNREGISTERED%'");
            }
        }

        return query;
    }

    /**
     * Get paginated unique suppliers for a workspace
     */
    static async getAll(workspaceId, filters = {}) {
        const { page = 1, limit = 10, sort_by, sort_order } = filters;
        const offset = (page - 1) * limit;

        try {
            const query = this._buildBaseQuery(workspaceId, filters);
            
            query.select([
                'sm.id',
                'sm.gstin',
                'sm.supplier_name as name',
                'sm.email',
                'sm.phone',
                knex.raw("COALESCE(scm.state, w.state, 'Other') as state_name"),
                'sm.is_active',
                'sm.created_at',
                'sm.updated_at'
            ]);

            const orderDir = sort_order === 'desc' ? 'desc' : 'asc';
            if (sort_by) {
                const sortMap = {
                    'name': 'sm.supplier_name',
                    'gstin': 'sm.gstin',
                    'state_name': knex.raw("COALESCE(scm.state, w.state, 'Other')")
                };
                const sortCol = sortMap[sort_by] || 'sm.supplier_name';
                query.orderBy(sortCol, orderDir, 'last');
            } else {
                query.orderBy('sm.supplier_name', 'asc', 'last');
            }

            query.limit(limit).offset(offset);

            const result = await query;
            return result || [];
        } catch (error) {
            console.error('[SupplierModel] Error in getAll:', error);
            throw error;
        }
    }

    /**
     * Get total count for pagination
     */
    static async countAll(workspaceId, filters = {}) {
        try {
            const query = this._buildBaseQuery(workspaceId, filters);
            const result = await query.count('sm.id as total').first();
            return parseInt(result?.total || 0);
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
        const { search, page = 1, limit = 10, supplier_gstin, supplier_name, state_codes, sort_by, sort_order } = filters;
        const offset = (page - 1) * limit;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            let baseParams = [workspaceId];
            let baseConds = ['WHERE workspace_id = ?::uuid'];

            let filterConds = [];
            let filterParams = [];

            if (supplier_gstin) {
                const gstins = supplier_gstin.split(',').map(s => s.trim()).filter(Boolean);
                if (gstins.length > 0) {
                    filterConds.push(`lf.gstin IN (${gstins.map(() => '?').join(',')})`);
                    filterParams.push(...gstins);
                }
            }
            if (supplier_name) {
                const names = supplier_name.split(',').map(s => s.trim()).filter(Boolean);
                if (names.length > 0) {
                    filterConds.push(`COALESCE(lf.name, sm.supplier_name) IN (${names.map(() => '?').join(',')})`);
                    filterParams.push(...names);
                }
            }
            if (state_codes) {
                const states = state_codes.split(',').map(s => s.trim()).filter(Boolean);
                if (states.length > 0) {
                    filterConds.push(`SUBSTRING(lf.gstin, 1, 2) IN (${states.map(() => '?').join(',')})`);
                    filterParams.push(...states);
                }
            }

            let filterClause = '';
            if (filterConds.length > 0) filterClause = ' AND ' + filterConds.join(' AND ');

            const orderColMap = {
                'name': 'name',
                'gstin': 'lf.gstin',
                'last_period': 'lf.filing_period',
                'last_date': 'lf.filing_date'
            };
            const sortCol = orderColMap[sort_by] || 'name';
            const orderDir = sort_order === 'desc' ? 'DESC' : 'ASC';

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
                WHERE (lf.gstin ILIKE ? OR lf.name ILIKE ?) ${filterClause}
                ORDER BY ${sortCol} ${orderDir} NULLS LAST
                LIMIT ? OFFSET ?
            `;

            const params = [
                workspaceId, 
                searchPattern,
                searchPattern,
                ...filterParams,
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
        const { search, supplier_gstin, supplier_name, state_codes } = filters;
        const searchPattern = search ? `%${search}%` : '%%';

        try {
            let filterConds = [];
            let filterParams = [];

            if (supplier_gstin) {
                const gstins = supplier_gstin.split(',').map(s => s.trim()).filter(Boolean);
                if (gstins.length > 0) {
                    filterConds.push(`gstin IN (${gstins.map(() => '?').join(',')})`);
                    filterParams.push(...gstins);
                }
            }
            if (supplier_name) {
                const names = supplier_name.split(',').map(s => s.trim()).filter(Boolean);
                if (names.length > 0) {
                    filterConds.push(`COALESCE(supplier_name, '') IN (${names.map(() => '?').join(',')})`);
                    filterParams.push(...names);
                }
            }
            if (state_codes) {
                const states = state_codes.split(',').map(s => s.trim()).filter(Boolean);
                if (states.length > 0) {
                    filterConds.push(`SUBSTRING(gstin, 1, 2) IN (${states.map(() => '?').join(',')})`);
                    filterParams.push(...states);
                }
            }

            let filterClause = '';
            if (filterConds.length > 0) filterClause = ' AND ' + filterConds.join(' AND ');

            const rawQuery = `
                WITH combined_filings AS (
                    SELECT supplier_gstin, workspace_id, supplier_name FROM normalized_gstr2a_invoices WHERE workspace_id = ?::uuid
                    UNION ALL
                    SELECT supplier_gstin, workspace_id, supplier_name FROM normalized_gstr2b_invoices WHERE workspace_id = ?::uuid
                ),
                all_suppliers AS (
                    SELECT gstin, supplier_name FROM supplier_master WHERE workspace_id = ?::uuid
                    UNION
                    SELECT supplier_gstin as gstin, supplier_name FROM combined_filings WHERE workspace_id = ?::uuid
                ),
                unique_suppliers AS (
                    SELECT DISTINCT gstin, FIRST_VALUE(supplier_name) OVER (PARTITION BY gstin) as supplier_name 
                    FROM all_suppliers
                )
                SELECT COUNT(*) as total FROM unique_suppliers
                WHERE (gstin ILIKE ? OR COALESCE(supplier_name, '') ILIKE ?) ${filterClause};
            `;

            const params = [
                workspaceId, workspaceId, workspaceId, workspaceId,
                searchPattern, searchPattern,
                ...filterParams
            ];

            const result = await knex.raw(rawQuery, params);
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
