const ConnectorModel = require('./connectorModel');
const knex = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * ConnectorController — API Key Management for Book Data Connectors
 *
 * Design:
 *   - Keys are scoped per ORGANIZATION (workspace_id), not per tenant.
 *   - ALL operations restricted to SUPER_ADMIN role only.
 *   - SuperAdmin operates cross-tenant: tenant_id + workspace_id come from
 *     the REQUEST BODY (POST/PATCH/DELETE) or QUERY PARAMS (GET).
 *     They are NOT derived from the requesting user's own JWT context.
 *   - The requesting user's identity is verified via JWT (verifyToken middleware)
 *     to confirm they are a SUPER_ADMIN in the system.
 */

// ── Helper: who is making the request ────────────────────────────────────────
const getRequestingUserId = (req) => {
    return req.user?.db_id || req.user?.id || req.user?.sub;
};

// ── Helper: global SUPER_ADMIN or Tenant Admin check ─────────────────────────
const isAuthorizedForWorkspace = async (userId, workspaceId) => {
    if (!userId) return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return false;

    // 1. System Super Admin
    const superAdminRecord = await knex('workspace_users')
        .where({ user_id: userId, role: 'SUPER_ADMIN' })
        .select('id')
        .first();
    if (superAdminRecord) return true;

    // 2. Tenant Admin for this specific workspace (only allowed if superadmin enabled it)
    if (workspaceId && uuidRegex.test(workspaceId)) {
        const workspace = await knex('workspaces')
            .where({ id: workspaceId })
            .select('settings')
            .first();
        if (workspace) {
            const settings = typeof workspace.settings === 'string'
                ? JSON.parse(workspace.settings)
                : (workspace.settings || {});
            
            if (settings.allow_tenant_api_keys === true) {
                const tenantAdminRecord = await knex('workspace_users')
                    .where({ user_id: userId, workspace_id: workspaceId })
                    .whereIn('role', ['TENANT_ADMIN', 'Tenant Admin'])
                    .select('id')
                    .first();
                if (tenantAdminRecord) return true;
            }
        }
    }

    return false;
};

// ── Middleware: guard all routes ─────────────────────────────────────────────
const requireSuperAdmin = async (req, res, next) => {
    const userId = getRequestingUserId(req);
    const workspaceId = req.query.workspace_id || req.body.workspace_id;
    if (!await isAuthorizedForWorkspace(userId, workspaceId)) {
        return errorResponse(res, 'Forbidden — only SUPER_ADMIN or Tenant Admin of this organization can manage API keys', 403);
    }
    next();
};

// ── Helper: verify workspace belongs to the given tenant ─────────────────────
const verifyWorkspaceBelongsToTenant = async (workspaceId, tenantId) => {
    const ws = await knex('workspaces')
        .where({ id: workspaceId, tenant_id: tenantId })
        .select('id', 'name')
        .first();
    return ws || null;
};


// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /connectors/api-keys?tenant_id=xxx&workspace_id=yyy
 *
 * Retrieve the API key record for a specific organization.
 * SUPER_ADMIN only.
 *
 * Query params:
 *   - tenant_id   (required)
 *   - workspace_id (required)
 */
const getApiKeys = async (req, res) => {
    try {
        const userId     = getRequestingUserId(req);
        const { tenant_id, workspace_id } = req.query;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'Query params tenant_id and workspace_id are required', 400);
        }

        // Verify workspace actually belongs to the stated tenant
        const workspace = await verifyWorkspaceBelongsToTenant(workspace_id, tenant_id);
        if (!workspace) {
            return errorResponse(res, 'Workspace not found or does not belong to the specified tenant', 404);
        }

        const record = await ConnectorModel.getByWorkspace(workspace_id, tenant_id);

        await logActivity({
            userId,
            tenantId:    tenant_id,
            workspaceId: workspace_id,
            actionType:  'VIEW_API_KEYS',
            entityType:  'CONNECTOR',
            details:     { workspace_name: workspace.name, found: !!record },
            req
        });

        if (!record) {
            return successResponse(res, null, `No API keys configured for workspace "${workspace.name}" yet`);
        }
        return successResponse(res, record, 'API keys retrieved successfully');
    } catch (error) {
        console.error('[ConnectorController.getApiKeys]', error);
        return errorResponse(res, error.message, 500);
    }
};


/**
 * POST /connectors/api-keys
 *
 * Generate production_key + sandbox_key for a specific organization.
 * SUPER_ADMIN only.
 *
 * Body: { tenant_id, workspace_id }
 *
 * Returns 409 if keys already exist for that workspace.
 * Use POST /connectors/api-keys/regenerate to rotate existing keys.
 */
const createApiKeys = async (req, res) => {
    try {
        const userId = getRequestingUserId(req);
        const { tenant_id, workspace_id, third_party_name, extrainfo } = req.body;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'Body must include tenant_id and workspace_id', 400);
        }

        // Verify workspace actually belongs to the stated tenant
        const workspace = await verifyWorkspaceBelongsToTenant(workspace_id, tenant_id);
        if (!workspace) {
            return errorResponse(res, 'Workspace not found or does not belong to the specified tenant', 404);
        }

        // One key per workspace — if already exists, return it with a clear message
        const existing = await ConnectorModel.getByWorkspace(workspace_id, tenant_id);
        if (existing) {
            return successResponse(
                res,
                existing,
                `API keys already exist for workspace "${workspace.name}". Here are the existing keys. Use POST /connectors/api-keys/regenerate to rotate them.`
            );
        }

        const record = await ConnectorModel.createKeys(workspace_id, tenant_id, third_party_name, extrainfo);

        await logActivity({
            userId,
            tenantId:    tenant_id,
            workspaceId: workspace_id,
            actionType:  'CREATE_API_KEYS',
            entityType:  'CONNECTOR',
            details:     { workspace_name: workspace.name, key_id: record.id, third_party_name: record.third_party_name },
            req
        });

        return successResponse(res, record, `API keys created for workspace "${workspace.name}"`);
    } catch (error) {
        console.error('[ConnectorController.createApiKeys]', error);
        return errorResponse(res, error.message, 500);
    }
};


/**
 * PATCH /connectors/api-keys
 *
 * Update status (active/inactive) or mode (live/demo) for a specific organization.
 * SUPER_ADMIN only.
 *
 * Body: { tenant_id, workspace_id, status?, mode?, third_party_name?, extrainfo? }
 */
const updateApiKeys = async (req, res) => {
    try {
        const userId = getRequestingUserId(req);
        const { tenant_id, workspace_id, status, mode, third_party_name, extrainfo } = req.body;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'Body must include tenant_id and workspace_id', 400);
        }
        if (!status && !mode && third_party_name === undefined && extrainfo === undefined) {
            return errorResponse(res, 'Provide at least one field to update: status, mode, third_party_name, or extrainfo', 400);
        }
        if (status && !['active', 'inactive'].includes(status)) {
            return errorResponse(res, 'status must be "active" or "inactive"', 400);
        }
        if (mode && !['live', 'demo'].includes(mode)) {
            return errorResponse(res, 'mode must be "live" or "demo"', 400);
        }

        const workspace = await verifyWorkspaceBelongsToTenant(workspace_id, tenant_id);
        if (!workspace) {
            return errorResponse(res, 'Workspace not found or does not belong to the specified tenant', 404);
        }

        const updated = await ConnectorModel.updateKeys(workspace_id, tenant_id, { status, mode, third_party_name, extrainfo });
        if (!updated) return errorResponse(res, 'No API keys found for this workspace', 404);

        await logActivity({
            userId,
            tenantId:    tenant_id,
            workspaceId: workspace_id,
            actionType:  'UPDATE_API_KEYS',
            entityType:  'CONNECTOR',
            details:     { workspace_name: workspace.name, status, mode, third_party_name, extrainfo },
            req
        });

        return successResponse(res, updated, 'API keys updated successfully');
    } catch (error) {
        console.error('[ConnectorController.updateApiKeys]', error);
        return errorResponse(res, error.message, 500);
    }
};


/**
 * POST /connectors/api-keys/regenerate
 *
 * Rotate production_key, sandbox_key, or both for a specific organization.
 * SUPER_ADMIN only.
 *
 * Body: { tenant_id, workspace_id, which?: "production"|"sandbox"|"both" }
 */
const regenerateApiKeys = async (req, res) => {
    try {
        const userId = getRequestingUserId(req);
        const { tenant_id, workspace_id, which = 'both' } = req.body;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'Body must include tenant_id and workspace_id', 400);
        }
        if (!['production', 'sandbox', 'both'].includes(which)) {
            return errorResponse(res, 'which must be "production", "sandbox", or "both"', 400);
        }

        const workspace = await verifyWorkspaceBelongsToTenant(workspace_id, tenant_id);
        if (!workspace) {
            return errorResponse(res, 'Workspace not found or does not belong to the specified tenant', 404);
        }

        const updated = await ConnectorModel.regenerateKeys(workspace_id, tenant_id, which);
        if (!updated) return errorResponse(res, 'No API keys found for this workspace', 404);

        await logActivity({
            userId,
            tenantId:    tenant_id,
            workspaceId: workspace_id,
            actionType:  'REGENERATE_API_KEYS',
            entityType:  'CONNECTOR',
            details:     { workspace_name: workspace.name, rotated: which },
            req
        });

        const label = which === 'both' ? 'Both keys' : `${which.charAt(0).toUpperCase() + which.slice(1)} key`;
        return successResponse(res, updated, `${label} regenerated for workspace "${workspace.name}"`);
    } catch (error) {
        console.error('[ConnectorController.regenerateApiKeys]', error);
        return errorResponse(res, error.message, 500);
    }
};


/**
 * DELETE /connectors/api-keys
 *
 * Permanently remove the API key record for a specific organization.
 * SUPER_ADMIN only.
 *
 * Body: { tenant_id, workspace_id }
 */
const deleteApiKeys = async (req, res) => {
    try {
        const userId = getRequestingUserId(req);
        const { tenant_id, workspace_id } = req.body;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'Body must include tenant_id and workspace_id', 400);
        }

        const workspace = await verifyWorkspaceBelongsToTenant(workspace_id, tenant_id);
        if (!workspace) {
            return errorResponse(res, 'Workspace not found or does not belong to the specified tenant', 404);
        }

        const deleted = await ConnectorModel.deleteKeys(workspace_id, tenant_id);
        if (!deleted) return errorResponse(res, 'No API keys found for this workspace', 404);

        await logActivity({
            userId,
            tenantId:    tenant_id,
            workspaceId: workspace_id,
            actionType:  'DELETE_API_KEYS',
            entityType:  'CONNECTOR',
            details:     { workspace_name: workspace.name },
            req
        });

        return successResponse(res, null, `API keys deleted for workspace "${workspace.name}"`);
    } catch (error) {
        console.error('[ConnectorController.deleteApiKeys]', error);
        return errorResponse(res, error.message, 500);
    }
};


/**
 * POST /connectors/validate-key   ← PUBLIC, no JWT required
 *
 * Called by an ERP connector (Tally, Zoho, SAP etc.) to authenticate
 * an inbound data push. Returns workspace context if key is valid.
 *
 * Body: { api_key: "prod_xxxx..." | "sand_xxxx..." }
 */
const validateApiKey = async (req, res) => {
    try {
        const { api_key } = req.body;
        if (!api_key) return errorResponse(res, 'api_key is required', 400);

        const context = await ConnectorModel.validateKey(api_key);
        if (!context) {
            return errorResponse(res, 'Invalid or inactive API key', 401);
        }

        return successResponse(res, context, 'API key is valid');
    } catch (error) {
        console.error('[ConnectorController.validateApiKey]', error);
        return errorResponse(res, error.message, 500);
    }
};


module.exports = {
    getApiKeys,
    createApiKeys,
    updateApiKeys,
    regenerateApiKeys,
    deleteApiKeys,
    validateApiKey,
    requireSuperAdmin
};
