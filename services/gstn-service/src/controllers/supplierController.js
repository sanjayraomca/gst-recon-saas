const Supplier = require('../models/supplier');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

const createSupplier = async (req, res) => {
    try {
        const {
            supplier_code, supplier_name, gstin, pan,
            contact_person, email, phone, address,
            supplier_type, risk_category, notes
        } = req.body;

        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return res.status(400).json({ error: 'Workspace ID required' });

        if (!supplier_name) return res.status(400).json({ error: 'Supplier Name is required' });

        const newSupplier = await Supplier.create({
            id: uuidv4(),
            workspace_id: workspaceId,
            supplier_code,
            supplier_name,
            gstin,
            pan,
            contact_person,
            email,
            phone,
            address: address ? JSON.stringify(address) : null,
            supplier_type: supplier_type || 'REGULAR',
            risk_category: risk_category || 'MEDIUM',
            notes,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date()
        });

        return successResponse(res, newSupplier, 'Supplier created successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listSuppliers = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return res.status(400).json({ error: 'Workspace ID required' });

        const { page = 1, page_size = 20, search, risk_category, supplier_type } = req.query;

        const suppliers = await Supplier.findAll(
            { workspace_id: workspaceId, search, risk_category, supplier_type },
            { page, page_size }
        );

        return successResponse(res, suppliers, 'Suppliers fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const supplier = await Supplier.findById(id);
        if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
        return successResponse(res, supplier, 'Supplier details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        updates.updated_at = new Date();

        if (updates.address) updates.address = JSON.stringify(updates.address);

        const updated = await Supplier.update(id, updates);
        if (!updated) return res.status(404).json({ error: 'Supplier not found' });

        return successResponse(res, updated, 'Supplier updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    createSupplier,
    listSuppliers,
    getSupplier,
    updateSupplier
};
