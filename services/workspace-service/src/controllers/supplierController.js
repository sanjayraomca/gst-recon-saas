const SupplierModel = require('../models/supplierModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * Get all suppliers with pagination and search
 */
const getAllSuppliers = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const filters = {
            search: req.query.search || '',
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.pageSize) || 10
        };

        const [suppliers, total] = await Promise.all([
            SupplierModel.getAll(workspaceId, filters),
            SupplierModel.countAll(workspaceId, filters)
        ]);
        
        return res.json({
            success: true,
            data: suppliers,
            pagination: {
                total,
                page: filters.page,
                pageSize: filters.limit,
                totalPages: Math.ceil(total / filters.limit)
            }
        });
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Update supplier contact details
 */
const updateSupplierContact = async (req, res) => {
    try {
        const { id } = req.params;
        const { email, phone } = req.body;

        if (!id) {
            return errorResponse(res, 'Supplier ID is required', 400);
        }

        const updated = await SupplierModel.updateContact(id, { email, phone });
        
        return successResponse(res, updated, 'Supplier contact updated successfully');
    } catch (error) {
        console.error('Error updating supplier contact:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllSuppliers,
    updateSupplierContact
};
