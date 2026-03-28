const SupplierModel = require('../models/supplierModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * Supplier Controller
 */
const getAllSuppliers = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const filters = {
            search: req.query.search || '',
            period: (req.query.period && req.query.period !== 'undefined') ? req.query.period : null,
            invoice_date_from: (req.query.invoice_date_from && req.query.invoice_date_from !== 'undefined') ? req.query.invoice_date_from : null,
            invoice_date_to: (req.query.invoice_date_to && req.query.invoice_date_to !== 'undefined') ? req.query.invoice_date_to : null
        };
        
        // Remove nulls so model doesn't try to use them
        Object.keys(filters).forEach(key => filters[key] === null && delete filters[key]);

        const suppliers = await SupplierModel.getAll(workspaceId, filters);
        
        return res.json({
            success: true,
            data: suppliers
        });
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllSuppliers
};
