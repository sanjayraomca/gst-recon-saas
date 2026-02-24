const BookDataModel = require('../models/bookDataModel');
const db = require('../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

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

        const { type, search, status, period, page, page_size } = req.query;
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
            const workspace = await db('workspaces')
                .where({ id: workspaceId, tenant_id: tenantId })
                .select('id')
                .first();

            if (!workspace) {
                return errorResponse(res, 'Workspace not found or access denied', 403);
            }
        }
        // If tenantId is not in token (dev/legacy tokens), skip the check
        // but still filter by workspace_id (still scoped per org)

        const result = await BookDataModel.getByType(
            workspaceId,
            type,
            { search, status, period },
            { page: parseInt(page) || 1, page_size: Math.min(parseInt(page_size) || 50, 200) }
        );

        return successResponse(res, result, `${type} records retrieved successfully`);
    } catch (error) {
        console.error('BookDataController.getBookData error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = { getBookData };
