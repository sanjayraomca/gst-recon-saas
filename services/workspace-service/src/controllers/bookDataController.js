const BookDataModel = require('../models/bookDataModel');
const knex = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * BookDataController
 * Handles listing of all 9 book data types with full tenant isolation.
 * - Requires X-Workspace-ID header
 * - Verifies the workspace belongs to the authenticated tenant (from JWT)
 */

const getBookData = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const { 
            type, search, status, period, gstin, date_from, date_to, 
            amt_min, amt_max, minNetAmt, maxNetAmt, place_of_supply, page, page_size, 
            sort_by, sort_dir, export_mode,
            gstins, parties, supply_type, roundoff_only, column_filters,
            import_filing_id, importFilingId
        } = req.query;

        if (!type) {
            return errorResponse(res, 'Query param "type" is required (e.g. sales_invoice, cn_purchase)', 400);
        }

        // === TENANT ISOLATION ===
        // Get tenant_id from JWT claims (req.user set by authMiddleware)
        const tenantId = req.user?.tenant_id
            || req.user?.tenantId
            || req.user?.['custom:tenant_id'];

        if (tenantId) {
            // Verify this workspace belongs to the authenticated tenant
            const workspace = await knex('workspaces')
                .where({ id: workspaceId, tenant_id: tenantId })
                .select('id')
                .first();

            if (!workspace) {
                return errorResponse(res, 'Workspace not found or access denied', 403);
            }
        }
        // If tenantId is not in token (dev/legacy tokens), skip the check
        // but still filter by workspace_id (still scoped per org)

        const pagination = (export_mode === 'true' || req.query.all === 'true')
            ? { page: 1, page_size: 50000 }
            : { page: parseInt(page) || 1, page_size: Math.min(parseInt(page_size) || 50, 50000) };

        // Parse multi-select arrays if they come as strings
        const parseArr = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            return val.split(',').filter(Boolean);
        };

        const result = await BookDataModel.getByType(
            workspaceId,
            type,
            { 
                search, status, period, gstin, date_from, date_to, 
                amt_min, amt_max, amt_net_min: minNetAmt, amt_net_max: maxNetAmt,
                place_of_supply, sort_by, sort_dir, 
                group_by_supplier: req.query.group_by_supplier || req.query.group_by || req.query.grouped,
                gstins: parseArr(gstins),
                parties: parseArr(parties),
                supply_type,
                roundoff_only,
                column_filters,
                import_filing_id: import_filing_id || importFilingId
            },
            pagination
        );

        // --- ACTIVITY LOG ---
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: tenantId,
            workspaceId: workspaceId,
            actionType: `VIEW_ALL_${(type || 'BOOK').toUpperCase()}_INVOICES`,
            entityType: 'BOOK_DATA',
            details: { 
                page_name: `${(type || 'Book').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Register`,
                filters: { 
                    search, status, period, gstin, date_from, date_to, 
                    amt_min, amt_max, minNetAmt, maxNetAmt, place_of_supply,
                    gstins, parties, supply_type, roundoff_only, column_filters
                },
                pagination,
                isExport: export_mode === 'true'
            },
            req
        });

        return successResponse(res, result, `${type} records retrieved successfully`);
    } catch (error) {
        console.error('BookDataController.getBookData error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const getBookDataSummary = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const { 
            period, year, date_from, date_to,
            amt_min, amt_max, minNetAmt, maxNetAmt,
            gstins, parties, supply_type, roundoff_only, place_of_supply,
            column_filters, search
        } = req.query;

        const tenantId = req.user?.tenant_id || req.user?.tenantId || req.user?.['custom:tenant_id'];
        if (tenantId) {
            const workspace = await knex('workspaces').where({ id: workspaceId, tenant_id: tenantId }).select('id').first();
            if (!workspace) return errorResponse(res, 'Workspace not found or access denied', 403);
        }

        const parseArr = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            return val.split(',').filter(Boolean);
        };

        const summary = await BookDataModel.getSummary(workspaceId, { 
            period, year, date_from, date_to,
            amt_min, amt_max, amt_net_min: minNetAmt, amt_net_max: maxNetAmt,
            gstins: parseArr(gstins),
            parties: parseArr(parties),
            supply_type,
            roundoff_only,
            place_of_supply,
            column_filters,
            search
        });

        // --- ACTIVITY LOG ---
        await logActivity({
            userId: req.user?.id || req.user?.sub,
            tenantId: tenantId,
            workspaceId: workspaceId,
            actionType: 'VIEW_SUMMARY',
            entityType: 'BOOK_DATA',
            details: { period, year },
            req
        });

        return successResponse(res, summary, 'Summary retrieved successfully');
    } catch (error) {
        console.error('BookDataController.getBookDataSummary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const getBookDataById = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const { id } = req.params;
        if (!id) return errorResponse(res, 'Voucher ID is required', 400);

        const tenantId = req.user?.tenant_id || req.user?.tenantId || req.user?.['custom:tenant_id'];
        if (tenantId) {
            const workspace = await knex('workspaces').where({ id: workspaceId, tenant_id: tenantId }).select('id').first();
            if (!workspace) return errorResponse(res, 'Workspace not found or access denied', 403);
        }

        const record = await BookDataModel.getById(workspaceId, id);
        if (!record) return errorResponse(res, 'Voucher not found', 404);

        return successResponse(res, record, 'Voucher retrieved successfully');
    } catch (error) {
        console.error('BookDataController.getBookDataById error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const getBookDataMasters = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const { type } = req.query;
        if (!type) return errorResponse(res, 'Query param "type" is required', 400);

        const tenantId = req.user?.tenant_id || req.user?.tenantId || req.user?.['custom:tenant_id'];
        if (tenantId) {
            const workspace = await knex('workspaces').where({ id: workspaceId, tenant_id: tenantId }).select('id').first();
            if (!workspace) return errorResponse(res, 'Workspace not found or access denied', 403);
        }

        const masters = await BookDataModel.getMasters(workspaceId, type);
        return successResponse(res, masters, 'Masters retrieved successfully');
    } catch (error) {
        console.error('BookDataController.getBookDataMasters error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const deleteBookDataById = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const { id } = req.params;
        if (!id) return errorResponse(res, 'Voucher/Invoice ID is required', 400);

        const tenantId = req.user?.tenant_id || req.user?.tenantId || req.user?.['custom:tenant_id'];
        if (tenantId) {
            const workspace = await knex('workspaces').where({ id: workspaceId, tenant_id: tenantId }).select('id').first();
            if (!workspace) return errorResponse(res, 'Workspace not found or access denied', 403);
        }

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // item_id allows deleting a single line item only; without it the entire voucher is deleted
        const itemId = req.body.item_id || null;

        const result = await BookDataModel.deleteById(
            workspaceId,
            id,
            tenantId,
            ipAddress,
            req.user,
            req.body.remark,
            itemId
        );

        // --- ACTIVITY LOG ---
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: tenantId,
            workspaceId: workspaceId,
            actionType: `DELETE_BOOK_DATA_ROW`,
            entityType: 'BOOK_DATA',
            details: {
                id,
                item_id: itemId,
                deletion_mode: result.deletionMode,
                type: result.type,
                subtype: result.subtype,
                remark: req.body.remark
            },
            req
        });

        return successResponse(res, result, 'Record deleted successfully');
    } catch (error) {
        console.error('BookDataController.deleteBookDataById error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = { getBookData, getBookDataSummary, getBookDataById, getBookDataMasters, deleteBookDataById };


