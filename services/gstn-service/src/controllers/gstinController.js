const GSTIN = require('../models/gstin');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

const createGSTIN = async (req, res) => {
    try {
        const {
            gstin, legal_name, trade_name, state_code,
            registration_date, taxpayer_type, registration_type,
            contact_person, contact_email, address
        } = req.body;
        // Workspace ID is passed via Header from Gateway or Client (X-Workspace-ID)
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return res.status(400).json({ error: 'X-Workspace-ID header is required' });
        }

        // Basic Validation
        if (!gstin || !legal_name || !state_code) {
            return res.status(400).json({ error: 'GSTIN, Legal Name and State Code are required' });
        }

        // Check Duplicate
        const existing = await GSTIN.findByGSTIN(gstin);
        if (existing) {
            return res.status(409).json({ error: 'GSTIN already registered' });
        }

        const newGSTIN = await GSTIN.create({
            id: uuidv4(),
            workspace_id: workspaceId,
            gstin,
            legal_name,
            trade_name,
            state_code,
            registration_date: registration_date ? new Date(registration_date) : null,
            registration_type: taxpayer_type || registration_type || 'REGULAR',
            contact_person,
            contact_email,
            address: address ? JSON.stringify(address) : null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date()
        });

        // Publish NATS event for GSTIN creation
        try {
            const { publishMessage } = require('../../../shared/src/nats/client');
            publishMessage('gstin.created', {
                gstin_id: newGSTIN.id,
                gstin: newGSTIN.gstin,
                workspace_id: newGSTIN.workspace_id,
                legal_name: newGSTIN.legal_name,
                created_at: newGSTIN.created_at
            });
            console.log(`Published gstin.created event for GSTIN: ${newGSTIN.gstin}`);
        } catch (natsError) {
            console.warn('Failed to publish GSTIN created event:', natsError.message);
            // Continue even if event publishing fails
        }

        return successResponse(res, newGSTIN, 'GSTIN registered successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listGSTINs = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) {
            return res.status(400).json({ error: 'X-Workspace-ID header is required' });
        }

        const gstins = await GSTIN.findAll({ workspace_id: workspaceId });
        return successResponse(res, gstins, 'GSTINs fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getGSTIN = async (req, res) => {
    try {
        const { id } = req.params;
        const gstin = await GSTIN.findById(id);
        if (!gstin) return res.status(404).json({ error: 'GSTIN not found' });
        return successResponse(res, gstin, 'GSTIN details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateGSTIN = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        updates.updated_at = new Date();

        // Ensure not updating immutable fields like id or workspace_id blindly if not intended
        // For now, passing updates directly but ideally should be whitelist

        const updatedGSTIN = await GSTIN.update(id, updates);
        if (!updatedGSTIN) return res.status(404).json({ error: 'GSTIN not found' });

        return successResponse(res, updatedGSTIN, 'GSTIN updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    createGSTIN,
    listGSTINs,
    getGSTIN,
    updateGSTIN
};
