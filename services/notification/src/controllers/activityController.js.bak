
const db = require('../config/db');

const getActivities = async (req, res) => {
    try {
        console.log('Activity params:', req.query);
        console.log('User context:', req.user);

        let tenantId = req.user?.tenantId || req.user?.tenant_id;
        const { page = 1, limit = 20, type, search } = req.query;
        const offset = (page - 1) * limit;

        // Fallback: If tenantId not in token, fetch from workspaces via user
        if (!tenantId && req.user?.email) {
            console.log('TenantID missing in token, looking up via workspaces for email:', req.user.email);

            // Join users -> workspace_users -> workspaces -> tenant_id
            const result = await db('users')
                .join('workspace_users', 'users.id', 'workspace_users.user_id')
                .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                .select('workspaces.tenant_id')
                .where('users.email', req.user.email)
                .first();

            if (result && result.tenant_id) {
                tenantId = result.tenant_id;
                console.log('Resolved tenantId from Workspace-User relation:', tenantId);
            } else {
                console.log('No tenant found for user via workspaces:', req.user.email);
            }
        }

        if (!tenantId) {
            return res.status(400).json({ success: false, error: 'Tenant context missing' });
        }

        let query = db('activity_logs')
            .where('tenant_id', tenantId) // Tenant Isolation
            .orderBy('created_at', 'desc');

        if (type && type !== 'ALL') {
            // Handle "Notices", "Tax Liabilities" etc. mapping if needed, or direct match
            // Assuming frontend sends categories like 'NOTICE', 'LIABILITY', etc.
            // Or broader filtering like:
            if (type === 'Notices') query.whereIn('entity_type', ['NOTICE', 'GST_NOTICE']);
            else if (type === 'Tax Liabilities') query.whereIn('action_type', ['LIABILITY_DUE', 'PAYMENT_PENDING']);
            else if (type === 'User Actions') query.whereIn('entity_type', ['USER', 'AUTH']);
            else query.where('action_type', type);
        }

        if (search) {
            query.where(builder => {
                builder.where('details', 'ilike', `%${search}%`)
                    .orWhere('action_type', 'ilike', `%${search}%`);
            });
        }

        // Clone for count - MUST clear order by to avoid SQL error with aggregates
        const countQuery = query.clone().clearOrder().count('id as total');
        const totalResult = await countQuery;
        const total = parseInt(totalResult[0]?.total || 0);

        const activities = await query.limit(limit).offset(offset);

        return res.status(200).json({
            success: true,
            data: activities,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Error fetching activities:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch activities' });
    }
};

module.exports = {
    getActivities
};
