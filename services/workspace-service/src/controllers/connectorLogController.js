const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { isPlatformSuperAdminById } = require('../../../shared/src/utils/workspaceAccess');

/**
 * GET /connector-logs
 * Lists records from tig_inbound_outbound_log with filters, search and pagination.
 *
 * IMPORTANT: this table holds inbound/outbound connector traffic (request/response
 * bodies, access keys used, IPs) for every tenant. It is scoped to the caller's own
 * tenant unless they are a platform super admin — previously the tenant_id query
 * param was optional and unverified, so any logged-in user could read (or, by
 * passing a different tenant_id, deliberately read) another tenant's connector logs.
 */
const getConnectorLogs = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');

        const isPlatAdmin = await isPlatformSuperAdminById(req.user && req.user.db_id);
        const callerTenantId = req.user ? req.user.tenantId : null;

        if (!isPlatAdmin && !callerTenantId) {
            return errorResponse(res, 'No tenant context for this account.', 403);
        }

        const {
            page = 1,
            page_size = 50,
            status,
            type,
            request_type,
            platform,
            search,
            date_from,
            date_to,
            org_id,
            tenant_id: tenantIdFilter,
        } = req.query;

        // A non-admin can never widen or redirect the scope away from their own
        // tenant; a platform admin may optionally filter down to one tenant.
        const effectiveTenantId = isPlatAdmin ? (tenantIdFilter || null) : callerTenantId;

        const limit = Math.min(parseInt(page_size) || 50, 200);
        const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

        // Build base filter query WITHOUT orderBy (COUNT fails with orderBy in Postgres)
        let baseQuery = knex('tig_inbound_outbound_log');

        if (effectiveTenantId) baseQuery = baseQuery.where('tenant_id', effectiveTenantId);
        if (status)         baseQuery = baseQuery.where('status', status);
        if (type)           baseQuery = baseQuery.where('type', type);
        if (request_type)   baseQuery = baseQuery.where('request_type', request_type);
        if (platform)       baseQuery = baseQuery.where('platform', platform);
        if (org_id)         baseQuery = baseQuery.where('org_id', org_id);

        if (date_from) baseQuery = baseQuery.where('created_at', '>=', date_from);
        if (date_to)   baseQuery = baseQuery.where('created_at', '<=', date_to);

        if (search) {
            baseQuery = baseQuery.where(function () {
                this.whereILike('platform', `%${search}%`)
                    .orWhereILike('status', `%${search}%`)
                    .orWhereILike('type', `%${search}%`)
                    .orWhereILike('request_type', `%${search}%`)
                    .orWhereILike('ip_address', `%${search}%`)
                    .orWhereILike('user_agent', `%${search}%`);
            });
        }

        // COUNT on unordered clone
        const countResult = await baseQuery.clone().count('id as total').first();
        const total = parseInt(countResult?.total || 0);

        // Data query with orderBy + pagination
        const logs = await baseQuery.clone()
            .select(
                'id', 'type', 'request_type', 'user_id', 'tenant_id', 'org_id',
                'access_key', 'platform', 't_params', 't_resp_headers', 't_resp_body',
                'ip_address', 'created_at', 'updated_at', 'user_agent', 'status', 'extrainfo'
            )
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);

        return successResponse(res, {
            data: logs,
            pagination: {
                page: parseInt(page),
                page_size: limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }, 'Connector logs retrieved successfully');
    } catch (error) {
        console.error('[connectorLogController] getConnectorLogs error:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * GET /connector-logs/:id
 * Returns a single log entry by UUID (for detail modal).
 */
const getConnectorLogById = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');
        const { id } = req.params;

        const log = await knex('tig_inbound_outbound_log').where({ id }).first();
        if (!log) {
            return errorResponse(res, 'Log entry not found', 404);
        }

        const isPlatAdmin = await isPlatformSuperAdminById(req.user && req.user.db_id);
        const callerTenantId = req.user ? req.user.tenantId : null;
        if (!isPlatAdmin && log.tenant_id !== callerTenantId) {
            // 404, not 403 — don't confirm to a stranger that this log id exists.
            return errorResponse(res, 'Log entry not found', 404);
        }

        return successResponse(res, log, 'Log entry retrieved successfully');
    } catch (error) {
        console.error('[connectorLogController] getConnectorLogById error:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * GET /connector-logs/stats
 * Returns aggregate counts grouped by status and platform for the summary cards.
 */
const getConnectorLogStats = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');

        const isPlatAdmin = await isPlatformSuperAdminById(req.user && req.user.db_id);
        const callerTenantId = req.user ? req.user.tenantId : null;
        if (!isPlatAdmin && !callerTenantId) {
            return errorResponse(res, 'No tenant context for this account.', 403);
        }
        const scope = (q) => (isPlatAdmin ? q : q.where('tenant_id', callerTenantId));

        const [total, byStatus, byPlatform] = await Promise.all([
            scope(knex('tig_inbound_outbound_log')).count('id as count').first(),
            scope(knex('tig_inbound_outbound_log'))
                .select('status')
                .count('id as count')
                .groupBy('status'),
            scope(knex('tig_inbound_outbound_log'))
                .select('platform')
                .count('id as count')
                .groupBy('platform')
                .orderBy('count', 'desc')
                .limit(10),
        ]);

        return successResponse(res, {
            total: parseInt(total?.count || 0),
            by_status: byStatus,
            by_platform: byPlatform,
        }, 'Connector log stats retrieved successfully');
    } catch (error) {
        console.error('[connectorLogController] getConnectorLogStats error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = { getConnectorLogs, getConnectorLogById, getConnectorLogStats };
