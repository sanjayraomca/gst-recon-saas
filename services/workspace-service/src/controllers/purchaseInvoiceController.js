const PurchaseInvoiceModel = require('../models/purchaseInvoiceModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * Get all purchase invoices with filters and pagination
 */
const getAllInvoices = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const filters = {
            gstin_id: req.query.gstin_id,
            supplier_id: req.query.supplier_id,
            invoice_date_from: req.query.invoice_date_from,
            invoice_date_to: req.query.invoice_date_to,
            itc_eligibility_status: req.query.itc_eligibility_status,
            reverse_charge: req.query.reverse_charge === 'true' ? true : req.query.reverse_charge === 'false' ? false : undefined,
            payment_status: req.query.payment_status,
            search: req.query.search
        };

        const pagination = {
            page: parseInt(req.query.page) || 1,
            page_size: Math.min(parseInt(req.query.page_size) || 50, 100)
        };

        const result = await PurchaseInvoiceModel.getAll(workspaceId, filters, pagination);
        
        // Log Activity
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'VIEW_ALL_PURCHASE_INVOICES',
            entityType: 'BOOK_DATA',
            details: { 
                page_name: 'Purchase Register',
                filters, 
                pagination 
            },
            req
        });

        return successResponse(res, {
            invoices: result.data,
            pagination: result.pagination
        }, 'Purchase invoices retrieved successfully');
    } catch (error) {
        console.error('Error fetching purchase invoices:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Get single purchase invoice by ID
 */
const getInvoiceById = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const invoice = await PurchaseInvoiceModel.getById(workspaceId, invoiceId);

        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        return successResponse(res, invoice, 'Purchase invoice retrieved successfully');
    } catch (error) {
        console.error('Error fetching invoice:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Create new purchase invoice
 */
const createInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        // Validate required fields
        const requiredFields = ['gstin_id', 'invoice_number', 'invoice_date', 'posting_date',
            'supplier_gstin', 'supplier_name', 'place_of_supply_code',
            'source_system', 'taxable_value'];

        for (const field of requiredFields) {
            if (!invoiceData[field]) {
                return errorResponse(res, `Missing required field: ${field}`, 400);
            }
        }

        // Validate GSTIN format
        const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstinRegex.test(invoiceData.supplier_gstin)) {
            return errorResponse(res, 'Invalid supplier GSTIN format', 400);
        }

        // Set defaults
        invoiceData.source_system = invoiceData.source_system || 'MANUAL';
        invoiceData.payment_status = invoiceData.payment_status || 'UNPAID';

        const invoice = await PurchaseInvoiceModel.create(workspaceId, invoiceData);

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'CREATE_PURCHASE_INVOICE',
            entityType: 'PurchaseInvoice',
            entityId: invoice.id,
            details: { invoiceNumber: invoiceData.invoice_number },
            req
        });

        return successResponse(res, invoice, 'Purchase invoice created successfully', 201);
    } catch (error) {
        console.error('Error creating purchase invoice:', error);
        if (error.message.includes('duplicate') || error.code === '23505') {
            return errorResponse(res, 'Invoice with this number already exists', 409);
        }
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Update purchase invoice
 */
const updateInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;
        const updateData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const invoice = await PurchaseInvoiceModel.update(workspaceId, invoiceId, updateData);

        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'UPDATE_PURCHASE_INVOICE',
            entityType: 'PurchaseInvoice',
            entityId: invoice.id,
            details: { invoiceId },
            req
        });

        return successResponse(res, invoice, 'Purchase invoice updated successfully');
    } catch (error) {
        console.error('Error updating invoice:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Create invoice amendment
 */
const amendInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;
        const amendmentData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        // Check if invoice exists
        const invoice = await PurchaseInvoiceModel.getById(workspaceId, invoiceId);
        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        // Feature not implemented yet
        return errorResponse(res, 'Amendment feature not implemented', 501);
    } catch (error) {
        console.error('Error creating amendment:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllInvoices,
    getInvoiceById,
    createInvoice,
    updateInvoice,
    amendInvoice
};
