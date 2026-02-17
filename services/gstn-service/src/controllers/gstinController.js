const GSTIN = require('../models/gstin');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { encrypt } = require('../../../shared/src/utils/encryption');

const createGSTIN = async (req, res) => {
    try {
        const {
            gstin, legal_name, trade_name, state_code,
            registration_date, taxpayer_type, registration_type,
            contact_person, contact_email, address, gstn_password
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

        // Encrypt GSTN password if provided
        let encryptedPassword = null;
        if (gstn_password) {
            try {
                encryptedPassword = encrypt(gstn_password);
            } catch (encryptError) {
                console.error('Password encryption failed:', encryptError);
                return res.status(500).json({ error: 'Failed to secure password' });
            }
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
            gstn_password_encrypted: encryptedPassword,
            password_updated_at: encryptedPassword ? new Date() : null,
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
        } catch (natsError) {
            // Silently fail or use proper logger if available
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

        const updatedGSTIN = await GSTIN.update(id, updates);
        if (!updatedGSTIN) return res.status(404).json({ error: 'GSTIN not found' });

        return successResponse(res, updatedGSTIN, 'GSTIN updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

/**
 * Test GSTN API connection with provided credentials
 * Used to validate GSTIN and password before organization creation
 */
const testGSTNConnection = async (req, res) => {
    try {
        const { gstin, password } = req.body;

        // Validate required fields
        if (!gstin || !password) {
            return res.status(400).json({
                success: false,
                error: 'GSTIN and password are required'
            });
        }

        // Validate GSTIN format: 2-digit state code + 10-char PAN + 1-char entity + 1-char checksum + Z + 1-char checksum
        const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
        if (!gstinRegex.test(gstin)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid GSTIN format'
            });
        }

        // TODO: Replace with actual GSTN API call
        // For now, simulate success for testing purposes
        // In production, integrate with actual GSTN API for authentication
        const connectionResult = await simulateGSTNAPICall(gstin, password);

        if (connectionResult.success) {
            return successResponse(res, {
                taxpayer_name: connectionResult.taxpayer_name,
                trade_name: connectionResult.trade_name,
                state_code: gstin.substring(0, 2)
            }, 'GSTN connection successful');
        } else {
            return res.status(401).json({
                success: false,
                error: connectionResult.error || 'Invalid GSTIN or password'
            });
        }
    } catch (error) {
        console.error('Test GSTN connection error:', error);
        return errorResponse(res, error, 'Failed to test GSTN connection');
    }
};

/**
 * Simulate GSTN API call
 * TODO: Replace with actual GSTN API integration
 */
async function simulateGSTNAPICall(gstin, password) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // For testing: Accept any password with length >= 6
    if (password.length >= 6) {
        return {
            success: true,
            taxpayer_name: 'Sample Company Private Limited',
            trade_name: 'Sample Co'
        };
    } else {
        return {
            success: false,
            error: 'Invalid credentials'
        };
    }
}

module.exports = {
    createGSTIN,
    listGSTINs,
    getGSTIN,
    updateGSTIN,
    testGSTNConnection
};
