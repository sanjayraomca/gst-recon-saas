const db = require('../../../shared/src/db/connection');

/**
 * RCM Liability Model
 * Matches rcm_liability_register table schema
 */
class RcmLiabilityModel {
    /**
     * Get all RCM liabilities with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            gstin_id,
            period_id,
            purchase_invoice_id,
            tax_type,
            liability_status,
            date_from,
            date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = db('rcm_liability_register')
            .where({ workspace_id: workspaceId });

        // Apply filters
        if (gstin_id) query = query.where({ gstin_id });
        if (period_id) query = query.where({ period_id });
        if (purchase_invoice_id) query = query.where({ purchase_invoice_id });
        if (tax_type) query = query.where({ tax_type }); // CGST, SGST, IGST...
        if (liability_status) query = query.where({ liability_status }); // PENDING, PAID
        if (date_from) query = query.where('created_at', '>=', date_from);
        if (date_to) query = query.where('created_at', '<=', date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results
        const liabilities = await query
            .orderBy('created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return {
            data: liabilities,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single liability by ID
     */
    static async getById(workspaceId, id) {
        return await db('rcm_liability_register')
            .where({
                id,
                workspace_id: workspaceId
            })
            .first();
    }

    /**
     * Create new liability
     */
    static async create(workspaceId, data) {
        const [liability] = await db('rcm_liability_register')
            .insert({
                id: db.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                gstin_id: data.gstin_id,
                period_id: data.period_id,
                purchase_invoice_id: data.purchase_invoice_id,
                tax_type: data.tax_type,
                tax_amount: data.tax_amount,
                liability_status: data.liability_status || 'PENDING',
                notes: data.notes,
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            })
            .returning('*');

        return liability;
    }

    /**
     * Update liability (specifically for payment recording)
     */
    static async update(workspaceId, id, updateData) {
        const allowedFields = [
            'liability_status',
            'cash_payment_date',
            'cash_payment_amount',
            'challan_number',
            'bank_ref_number',
            'payment_proof_document_id',
            'notes'
        ];

        const filteredData = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredData[key] = updateData[key];
            }
        });

        filteredData.updated_at = db.fn.now();

        const [liability] = await db('rcm_liability_register')
            .where({
                id,
                workspace_id: workspaceId
            })
            .update(filteredData)
            .returning('*');

        return liability;
    }
}

module.exports = RcmLiabilityModel;
