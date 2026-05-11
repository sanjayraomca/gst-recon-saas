const Gstr2bInvoiceModel = require('../models/gstr2bInvoiceModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * Get all GSTR2B invoices with filters and pagination
 */
const getAllInvoices = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const filters = {
            gstin_id: req.query.gstin_id,
            period: req.query.period,
            match_status: req.query.match_status,
            supplier_gstin: req.query.supplier_gstin,
            invoice_date_from: req.query.invoice_date_from,
            invoice_date_to: req.query.invoice_date_to
        };

        const page_size = Math.min(parseInt(req.query.page_size) || 50, 10000);
        const pagination = {
            page: parseInt(req.query.page) || 1,
            page_size
        };

        const result = await Gstr2bInvoiceModel.getAll(workspaceId, filters, pagination);

        // Log Activity
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'VIEW_ALL_GSTR2B_INVOICES',
            entityType: 'GSTR_DATA',
            details: { 
                page_name: 'GSTR-2B Register',
                filters, 
                pagination 
            },
            req
        });

        return successResponse(res, {
            invoices: result.data,
            pagination: result.pagination
        }, 'GSTR2B invoices retrieved successfully');
    } catch (error) {
        console.error('Error fetching GSTR2B invoices:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Get single GSTR2B invoice by ID
 */
const getInvoiceById = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const invoice = await Gstr2bInvoiceModel.getById(workspaceId, invoiceId);

        if (!invoice) {
            return errorResponse(res, 'GSTR2B invoice not found', 404);
        }

        // Log Activity
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'VIEW_GSTR2B_RECORD',
            entityType: 'GSTR_DATA',
            entityId: invoiceId,
            details: { invoice_number: invoice.document_number_clean || invoice.document_number_raw },
            req
        });

        return successResponse(res, invoice, 'GSTR2B invoice retrieved successfully');
    } catch (error) {
        console.error('Error fetching GSTR2B invoice:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllInvoices,
    getInvoiceById
};
