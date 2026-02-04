const db = require('../../../shared/src/db/connection');

class ReconciliationConfigModel {
    static async create(workspaceId, data, userId) {
        const {
            config_name,
            config_type,
            invoice_number_tolerance = 'EXACT',
            date_tolerance_days = 0,
            amount_tolerance_percentage = 1.00,
            tax_tolerance_percentage = 0.00,
            auto_match_threshold = 95.00,
            require_manual_review = false,
            exclude_rcm = false,
            exclude_blocked_itc = true,
            is_active = true,
            is_default = false
        } = data;

        const [config] = await db('reconciliation_configs')
            .insert({
                id: db.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                config_name,
                config_type,
                invoice_number_tolerance,
                date_tolerance_days,
                amount_tolerance_percentage,
                tax_tolerance_percentage,
                auto_match_threshold,
                require_manual_review,
                exclude_rcm,
                exclude_blocked_itc,
                is_active,
                is_default,
                rule_set_version: '1.0.0',
                rule_set_hash: 'default_rules_v1', // Placeholder hash
                created_by: userId,
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            })
            .returning('*');

        return config;
    }

    static async update(workspaceId, configId, data) {
        // Only allow updating known fields
        const allowedFields = [
            'config_name', 'invoice_number_tolerance', 'date_tolerance_days',
            'amount_tolerance_percentage', 'tax_tolerance_percentage',
            'auto_match_threshold', 'require_manual_review', 'exclude_rcm',
            'exclude_blocked_itc', 'is_active', 'is_default'
        ];

        const updateData = {};
        for (const field of allowedFields) {
            if (data[field] !== undefined) updateData[field] = data[field];
        }

        updateData.updated_at = db.fn.now();

        const [config] = await db('reconciliation_configs')
            .where({ id: configId, workspace_id: workspaceId })
            .update(updateData)
            .returning('*');

        return config;
    }

    static async getById(workspaceId, configId) {
        return db('reconciliation_configs')
            .where({ id: configId, workspace_id: workspaceId })
            .first();
    }

    static async list(workspaceId, filters = {}, pagination = {}) {
        const { page = 1, page_size = 20 } = pagination;
        const offset = (page - 1) * page_size;

        const query = db('reconciliation_configs')
            .where({ workspace_id: workspaceId });

        if (filters.config_type) query.where({ config_type: filters.config_type });
        if (filters.is_active !== undefined) query.where({ is_active: filters.is_active });

        const configs = await query.clone()
            .orderBy('created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        return configs;
    }
}

module.exports = ReconciliationConfigModel;
