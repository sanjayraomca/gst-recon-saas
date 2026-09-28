const GSTIN = require('../models/gstin');
const { v4: uuidv4 } = require('uuid');
const knex = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { encrypt } = require('../../../shared/src/utils/encryption');
const { UUID_RE, canAccessWorkspace, isPlatformSuperAdminById } = require('../../../shared/src/utils/workspaceAccess');

// Matches the CHECK constraint on gstin_master.registration_type
const REGISTRATION_TYPES = ['REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'ISD', 'CASUAL'];

// Fields a client may change via PUT /gstins/:id (GSTIN number and legal name are immutable)
const UPDATABLE_FIELDS = ['trade_name', 'contact_person', 'contact_email', 'contact_phone', 'is_active', 'address'];

/**
 * Never return the encrypted portal password to clients.
 */
const toPublicGstin = (row, extra = {}) => {
    if (!row) return row;
    const { gstin_pwd_encrypted, ...rest } = row;
    return { ...rest, has_gstn_password: !!gstin_pwd_encrypted, ...extra };
};

/**
 * gstin_master is a decoupled master table (no workspace_id column). A GSTIN belongs to a
 * workspace through workspaces.gstin_id (or the legacy workspaces.gstn text column).
 * A user may see/modify a GSTIN only if they can access a workspace linked to it.
 */
const canAccessGstin = async (dbUserId, gstinRow) => {
    if (await isPlatformSuperAdminById(dbUserId)) return true;
    if (!dbUserId || !UUID_RE.test(String(dbUserId))) return false;
    const link = await knex('workspace_users')
        .join('workspaces', 'workspaces.id', 'workspace_users.workspace_id')
        .where('workspace_users.user_id', dbUserId)
        .where('workspace_users.invitation_status', 'ACTIVE')
        .whereNull('workspace_users.removed_at')
        .whereNull('workspaces.deleted_at')
        .where(function () {
            this.where('workspaces.gstin_id', gstinRow.id).orWhere('workspaces.gstn', gstinRow.gstin);
        })
        .first('workspaces.id');
    return !!link;
};

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
        if (!UUID_RE.test(workspaceId)) {
            return res.status(400).json({ error: 'X-Workspace-ID must be a valid UUID' });
        }

        // Basic Validation
        if (!gstin || !legal_name || !state_code) {
            return res.status(400).json({ error: 'GSTIN, Legal Name and State Code are required' });
        }

        const regType = String(taxpayer_type || registration_type || 'REGULAR').toUpperCase();
        if (!REGISTRATION_TYPES.includes(regType)) {
            return res.status(400).json({ error: `registration_type must be one of ${REGISTRATION_TYPES.join(', ')}` });
        }

        // Authorization: caller must be able to access the workspace they are registering into
        if (!(await canAccessWorkspace(req.user?.db_id, workspaceId))) {
            return res.status(403).json({ error: 'You do not have access to this workspace' });
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
                console.error('GSTN password encryption failed:', encryptError.message);
                return res.status(500).json({ error: 'Failed to secure password' });
            }
        }

        let newGSTIN;
        let linkedToWorkspace = false;
        await knex.transaction(async (trx) => {
            // Column names follow infra/postgres/02-gst-init.sql (gstin_master has no workspace_id)
            [newGSTIN] = await trx('gstin_master')
                .insert({
                    id: uuidv4(),
                    gstin,
                    legal_name,
                    trade_name,
                    state_code,
                    registration_date: registration_date ? new Date(registration_date) : null,
                    registration_type: regType,
                    contact_person,
                    contact_email,
                    address: address ? JSON.stringify(address) : null,
                    gstin_pwd_encrypted: encryptedPassword,
                    password_updated_at: encryptedPassword ? new Date() : null,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .returning('*');

            // Link to the workspace if it doesn't have a GSTIN yet
            const updated = await trx('workspaces')
                .where({ id: workspaceId })
                .whereNull('gstin_id')
                .update({ gstin_id: newGSTIN.id, updated_at: new Date() });
            linkedToWorkspace = updated > 0;
        });

        // Publish NATS event for GSTIN creation
        try {
            const { publishMessage } = require('../../../shared/src/nats/client');
            publishMessage('gstin.created', {
                gstin_id: newGSTIN.id,
                gstin: newGSTIN.gstin,
                workspace_id: workspaceId,
                legal_name: newGSTIN.legal_name,
                created_at: newGSTIN.created_at
            });
        } catch (natsError) {
            console.warn('Failed to publish gstin.created:', natsError.message);
        }

        await logActivity({
            userId: req.user?.db_id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'ADD_GSTIN',
            entityType: 'GSTIN',
            entityId: newGSTIN.id,
            details: { gstin: newGSTIN.gstin, linked_to_workspace: linkedToWorkspace },
            req
        });

        return successResponse(
            res,
            toPublicGstin(newGSTIN, { workspace_id: workspaceId, linked_to_workspace: linkedToWorkspace }),
            'GSTIN registered successfully'
        );
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
        if (!UUID_RE.test(workspaceId)) {
            return res.status(400).json({ error: 'X-Workspace-ID must be a valid UUID' });
        }
        if (!(await canAccessWorkspace(req.user?.db_id, workspaceId))) {
            return res.status(403).json({ error: 'You do not have access to this workspace' });
        }

        // GSTINs linked to this workspace (new gstin_id link or legacy gstn text column)
        const gstins = await knex('gstin_master')
            .join('workspaces', function () {
                this.on('workspaces.gstin_id', '=', 'gstin_master.id')
                    .orOn('workspaces.gstn', '=', 'gstin_master.gstin');
            })
            .where('workspaces.id', workspaceId)
            .distinct('gstin_master.*');

        return successResponse(res, gstins.map(g => toPublicGstin(g)), 'GSTINs fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getGSTIN = async (req, res) => {
    try {
        const { id } = req.params;
        if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid GSTIN id' });

        const gstin = await GSTIN.findById(id);
        // Same 404 whether it doesn't exist or belongs to someone else (don't leak existence)
        if (!gstin || !(await canAccessGstin(req.user?.db_id, gstin))) {
            return res.status(404).json({ error: 'GSTIN not found' });
        }
        return successResponse(res, toPublicGstin(gstin), 'GSTIN details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateGSTIN = async (req, res) => {
    try {
        const { id } = req.params;
        if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid GSTIN id' });

        const existing = await GSTIN.findById(id);
        if (!existing || !(await canAccessGstin(req.user?.db_id, existing))) {
            return res.status(404).json({ error: 'GSTIN not found' });
        }

        // Whitelist: never let the request body write arbitrary columns (e.g. gstin, legal_name,
        // gstin_pwd_encrypted, metadata). The password is accepted in plain text and encrypted here.
        const updates = {};
        for (const field of UPDATABLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates[field] = field === 'address' && req.body.address && typeof req.body.address === 'object'
                    ? JSON.stringify(req.body.address)
                    : req.body[field];
            }
        }
        if (req.body.gstn_password) {
            try {
                updates.gstin_pwd_encrypted = encrypt(req.body.gstn_password);
                updates.password_updated_at = new Date();
            } catch (encryptError) {
                console.error('GSTN password encryption failed:', encryptError.message);
                return res.status(500).json({ error: 'Failed to secure password' });
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: `Nothing to update. Allowed fields: ${UPDATABLE_FIELDS.join(', ')}, gstn_password` });
        }
        updates.updated_at = new Date();

        const updatedGSTIN = await GSTIN.update(id, updates);

        await logActivity({
            userId: req.user?.db_id,
            tenantId: req.user?.tenant_id,
            workspaceId: req.headers['x-workspace-id'] || null,
            actionType: 'UPDATE_GSTIN',
            entityType: 'GSTIN',
            entityId: id,
            details: { gstin: updatedGSTIN.gstin, fields: Object.keys(updates).filter(f => f !== 'gstin_pwd_encrypted') },
            req
        });

        return successResponse(res, toPublicGstin(updatedGSTIN), 'GSTIN updated successfully');
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
            return res.status(400).json({
                success: false,
                error: connectionResult.error || 'Invalid GSTIN or password'
            });
        }
    } catch (error) {
        //  console.error('Test GSTN connection error:', error);
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
