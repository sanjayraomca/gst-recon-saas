const RcmLiabilityModel = require('../models/rcmLiabilityModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

// Get all liabilities
exports.listLiabilities = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const result = await RcmLiabilityModel.getAll(workspaceId, req.query, req.query);
        return successResponse(res, result);
    } catch (error) {
        console.error('Error in listLiabilities:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Pay liability
exports.payLiability = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const { id } = req.params;
        const {
            payment_date,
            payment_amount,
            challan_number,
            bank_ref_number,
            payment_proof_document_id,
            notes
        } = req.body;

        if (!payment_date || !payment_amount) {
            return errorResponse(res, 'Payment date and amount are required', 400);
        }

        const liability = await RcmLiabilityModel.update(workspaceId, id, {
            liability_status: 'PAID', // Auto-update status
            cash_payment_date: payment_date,
            cash_payment_amount: payment_amount,
            challan_number,
            bank_ref_number,
            payment_proof_document_id,
            notes
        });

        if (!liability) {
            return errorResponse(res, 'Liability not found', 404);
        }

        return successResponse(res, liability, 'Liability paid successfully');
    } catch (error) {
        console.error('Error in payLiability:', error);
        return errorResponse(res, error.message, 500);
    }
};
