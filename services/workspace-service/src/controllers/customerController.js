const CustomerModel = require('../models/customerModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * Get all customers with pagination and search
 */
const getAllCustomers = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
        }

        const filters = {
            search: req.query.search || '',
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.page_size) || parseInt(req.query.pageSize) || 10,
            registration_status: req.query.registration_status,
            customer_gstin: req.query.customer_gstin,
            customer_name: req.query.customer_name,
            state_codes: req.query.state_codes,
            from_date: req.query.from_date,
            to_date: req.query.to_date,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order
        };

        const [customers, total] = await Promise.all([
            CustomerModel.getAll(workspaceId, filters),
            CustomerModel.countAll(workspaceId, filters)
        ]);
        
        return res.json({
            success: true,
            data: customers,
            pagination: {
                total,
                page: filters.page,
                pageSize: filters.limit,
                totalPages: Math.ceil(total / filters.limit)
            }
        });
    } catch (error) {
        console.error('Error fetching customers:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Update customer contact details
 */
const updateCustomerContact = async (req, res) => {
    try {
        const { id } = req.params;
        const { email, phone } = req.body;

        if (!id) {
            return errorResponse(res, 'Customer ID is required', 400);
        }

        const updated = await CustomerModel.updateContact(id, { email, phone });
        
        return successResponse(res, updated, 'Customer contact updated successfully');
    } catch (error) {
        console.error('Error updating customer contact:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllCustomers,
    updateCustomerContact
};
