const knex = require('../../../shared/src/db/connection');

/**
 * GSTR2B Invoice Model (Read-only)
 * Matches gstr2b_invoices table schema
 */
class Gstr2bInvoiceModel {
    /**
     * Get all GSTR2B invoices with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            gstin_id,
            period,
            match_status,
            supplier_gstin,
            invoice_date_from,
            invoice_date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = knex('gstr2b_invoices')
            .where({ workspace_id: workspaceId });

        // Apply filters
        if (gstin_id) query = query.where({ gstin_id });
        if (match_status) query = query.where({ match_status });
        if (supplier_gstin) query = query.where({ supplier_gstin });
        if (invoice_date_from) query = query.where('invoice_date', '>=', invoice_date_from);
        if (invoice_date_to) query = query.where('invoice_date', '<=', invoice_date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results
        const invoices = await query
            .orderBy('invoice_date', 'desc')
            .limit(page_size)
            .offset(offset);

        return {
            data: invoices,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single GSTR2B invoice by ID
     */
    static async getById(workspaceId, invoiceId) {
        return await knex('gstr2b_invoices')
            .where({
                id: invoiceId,
                workspace_id: workspaceId
            })
            .first();
    }
}

module.exports = Gstr2bInvoiceModel;
