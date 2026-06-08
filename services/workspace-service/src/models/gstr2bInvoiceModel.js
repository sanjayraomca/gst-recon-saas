const knex = require('../../../shared/src/db/connection');

/**
 * GSTR2B Invoice Model
 * Matches normalized_gstr2b_invoices table schema
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
            reconciliation_status,
            supplier_gstin,
            invoice_date_from,
            invoice_date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = knex('normalized_gstr2b_invoices')
            .where({ workspace_id: workspaceId });

        // Apply filters — column names match normalized_gstr2b_invoices schema
        if (gstin_id) query = query.where({ gstin_id });
        // match_status param → reconciliation_status column (match_status does not exist)
        const resolvedStatus = reconciliation_status || match_status;
        if (resolvedStatus) query = query.where({ reconciliation_status: resolvedStatus });
        if (supplier_gstin) query = query.where({ supplier_gstin });
        if (period && period !== 'ALL') query = query.where({ return_period: period });
        if (invoice_date_from) query = query.where('document_date', '>=', invoice_date_from);
        if (invoice_date_to) query = query.where('document_date', '<=', invoice_date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results
        const invoices = await query
            .orderBy('document_date', 'desc')
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
        return await knex('normalized_gstr2b_invoices')
            .where({
                id: invoiceId,
                workspace_id: workspaceId
            })
            .first();
    }
}

module.exports = Gstr2bInvoiceModel;
