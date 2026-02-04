const db = require('../../../shared/src/db/connection');

/**
 * ITC Decision Model
 * Matches itc_decisions table schema
 */
class ItcDecisionModel {
    /**
     * Get all ITC decisions with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            gstin_id,
            period_id,
            purchase_invoice_id,
            decision,
            decision_type,
            date_from,
            date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = db('itc_decisions')
            .join('purchase_invoices', 'itc_decisions.purchase_invoice_id', 'purchase_invoices.id')
            .where({ 'itc_decisions.workspace_id': workspaceId });

        // Apply filters
        if (gstin_id) query = query.where({ 'purchase_invoices.gstin_id': gstin_id }); // Filter on joined table
        if (period_id) query = query.where({ 'itc_decisions.period_id': period_id });
        if (purchase_invoice_id) query = query.where({ 'itc_decisions.purchase_invoice_id': purchase_invoice_id });
        if (decision) query = query.where({ decision });
        if (decision_type) query = query.where({ decision_type });
        if (date_from) query = query.where('itc_decisions.created_at', '>=', date_from);
        if (date_to) query = query.where('itc_decisions.created_at', '<=', date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('itc_decisions.id as count');

        // Get paginated results
        const decisions = await query
            .select('itc_decisions.*')
            .orderBy('itc_decisions.created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return {
            data: decisions,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single decision by ID
     */
    static async getById(workspaceId, id) {
        return await db('itc_decisions')
            .where({
                id,
                workspace_id: workspaceId
            })
            .first();
    }

    /**
     * Create new decision
     */
    static async create(workspaceId, data) {
        const [decision] = await db('itc_decisions')
            .insert({
                id: db.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                // gstin_id removed as per schema
                period_id: data.period_id,
                purchase_invoice_id: data.purchase_invoice_id,
                decision: data.decision, // CLAIM, DEFER, REVERSE
                decision_type: data.decision_type || 'MANUAL',
                itc_amount: data.itc_amount || 0,
                gst_section: data.gst_section,
                decision_reason: data.decision_reason,
                notes: data.notes,
                created_by: data.user_id, // assuming passed from context
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            })
            .returning('*');

        return decision;
    }

    /**
     * Update decision
     */
    static async update(workspaceId, id, updateData) {
        // Only allow updating specific fields
        const allowedFields = [
            'decision',
            'decision_reason',
            'notes',
            'gst_section'
        ];

        const filteredData = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredData[key] = updateData[key];
            }
        });

        filteredData.updated_at = db.fn.now();

        const [decision] = await db('itc_decisions')
            .where({
                id,
                workspace_id: workspaceId
            })
            .update(filteredData)
            .returning('*');

        return decision;
    }
}

module.exports = ItcDecisionModel;
