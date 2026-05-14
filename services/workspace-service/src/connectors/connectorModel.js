const knex = require('../../../shared/src/db/connection');
const crypto = require('crypto');

/**
 * ConnectorModel
 * DB operations for workspace_api_keys (final schema).
 * One record per workspace — contains production_key and sandbox_key.
 */

// ── Key generation ────────────────────────────────────────────────────────────
const generateKey = (prefix) => {
    const secret = crypto.randomBytes(32).toString('hex'); // 64-char hex
    return `${prefix}_${secret}`;
};

/**
 * Get the API key record for a workspace (or null if none exists).
 */
const getByWorkspace = async (workspaceId, tenantId) => {
    return knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .select(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'created_at', 'updated_at'])
        .first();
};

/**
 * Create API keys for a workspace (one-time setup, SUPER_ADMIN only).
 * Generates both production_key and sandbox_key.
 */
const createKeys = async (workspaceId, tenantId) => {
    const productionKey = generateKey('prod');
    const sandboxKey    = generateKey('sand');

    const [record] = await knex('workspace_api_keys')
        .insert({
            workspace_id:   workspaceId,
            tenant_id:      tenantId,
            production_key: productionKey,
            sandbox_key:    sandboxKey,
            status:         'active',
            mode:           'live'
        })
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'created_at']);

    return record;
};

/**
 * Update status (active/inactive) or mode (live/demo).
 */
const updateKeys = async (workspaceId, tenantId, { status, mode }) => {
    const updates = { updated_at: knex.fn.now() };
    if (status !== undefined) updates.status = status;
    if (mode   !== undefined) updates.mode   = mode;

    const [updated] = await knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .update(updates)
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'updated_at']);

    return updated || null;
};

/**
 * Regenerate both keys (or just one) for a workspace.
 */
const regenerateKeys = async (workspaceId, tenantId, which = 'both') => {
    const updates = { updated_at: knex.fn.now() };
    if (which === 'both' || which === 'production') {
        updates.production_key = generateKey('prod');
    }
    if (which === 'both' || which === 'sandbox') {
        updates.sandbox_key = generateKey('sand');
    }

    const [updated] = await knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .update(updates)
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'updated_at']);

    return updated || null;
};

/**
 * Delete the API key record for a workspace entirely.
 */
const deleteKeys = async (workspaceId, tenantId) => {
    return knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .delete();
};

/**
 * Validate an inbound key (used by the import middleware).
 * Returns { workspaceId, tenantId, mode } if valid, null otherwise.
 */
const validateKey = async (inboundKey) => {
    if (!inboundKey) return null;

    const record = await knex('workspace_api_keys')
        .where(function () {
            this.where('production_key', inboundKey).orWhere('sandbox_key', inboundKey);
        })
        .where({ status: 'active' })
        .select(['id', 'workspace_id', 'tenant_id', 'mode', 'production_key'])
        .first();

    if (!record) return null;

    const isProduction = record.production_key === inboundKey;

    return {
        keyId:       record.id,
        workspaceId: record.workspace_id,
        tenantId:    record.tenant_id,
        mode:        isProduction ? 'live' : 'demo',
        keyType:     isProduction ? 'production' : 'sandbox'
    };
};

module.exports = { getByWorkspace, createKeys, updateKeys, regenerateKeys, deleteKeys, validateKey };
