const BookDataModel = require('../models/bookDataModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * BookDataController
 * Handles listing of all 9 book data types (sales/purchase invoices, CN, DN, returns, etc.)
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
