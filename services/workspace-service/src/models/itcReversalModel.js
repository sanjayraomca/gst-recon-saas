const db = require('../../../shared/src/db/connection');

/**
 * ITC Reversal Model
 * Matches itc_reversal_register table schema
 */
class ItcReversalModel {
    /**
     * Get all reversals with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            gstin_id,
            period_id,
            purchase_invoice_id,
            reversal_type,
            is_reclaimable,
            is_reclaimed,
            date_from,
            date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = db('itc_reversal_register')
            .where({ workspace_id: workspaceId });

        // Apply filters
        if (gstin_id) query = query.where({ gstin_id });
        if (period_id) query = query.where({ period_id });
        if (purchase_invoice_id) query = query.where({ purchase_invoice_id });
        if (reversal_type) query = query.where({ reversal_type });
        if (is_reclaimable !== undefined) query = query.where({ is_reclaimable });

        // Custom logic for "is_reclaimed" based on reclaim_date/amount presence
        if (is_reclaimed === 'true' || is_reclaimed === true) {
            query = query.whereNotNull('reclaim_date');
        } else if (is_reclaimed === 'false' || is_reclaimed === false) {
            query = query.whereNull('reclaim_date');
        }

        if (date_from) query = query.where('created_at', '>=', date_from);
        if (date_to) query = query.where('created_at', '<=', date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results
        const reversals = await query
            .orderBy('created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return {
            data: reversals,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single reversal by ID
     */
    static async getById(workspaceId, id) {
        return await db('itc_reversal_register')
            .where({
                id,
                workspace_id: workspaceId
            })
            .first();
    }

    /**
     * Create new reversal entry (usually automated, but can be manual)
     */
    static async create(workspaceId, data) {
        const [reversal] = await db('itc_reversal_register')
            .insert({
                id: db.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                gstin_id: data.gstin_id,
                period_id: data.period_id,
                purchase_invoice_id: data.purchase_invoice_id,
                reversal_type: data.reversal_type, // 180_DAY_RULE, BLOCKED, OTHER
                reversal_amount: data.reversal_amount,
                cgst_amount: data.cgst_amount || 0,
                sgst_amount: data.sgst_amount || 0,
                igst_amount: data.igst_amount || 0,
                cess_amount: data.cess_amount || 0,
                is_reclaimable: data.is_reclaimable || false,
                notes: data.notes,
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            })
            .returning('*');

        return reversal;
    }

    /**
     * Update reversal (specifically for reclaiming)
     */
    static async update(workspaceId, id, updateData) {
        const allowedFields = [
            'reclaim_date',
            'reclaim_amount',
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

        const [reversal] = await db('itc_reversal_register')
            .where({
                id,
                workspace_id: workspaceId
            })
            .update(filteredData)
            .returning('*');

        return reversal;
    }
}

module.exports = ItcReversalModel;
