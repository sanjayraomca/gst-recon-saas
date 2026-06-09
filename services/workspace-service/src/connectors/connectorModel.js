const knex = require('../../../shared/src/db/connection');
const crypto = require('crypto');

/**
 * ConnectorModel
 * DB operations for workspace_api_keys (final schema).
 * One record per workspace — contains production_key and sandbox_key.
 */

// ── Key generation ────────────────────────────────────────────────────────────
// ── Key generation ────────────────────────────────────────────────────────────
const generateKey = () => {
    return crypto.randomBytes(16).toString('hex'); // exactly 32 hex characters
};

// ── Secondary Connection for GSP Provider Database ───────────────────────────
const gspDb = require('knex')({
    client: 'pg',
    connection: {
        host: process.env.GSP_DB_HOST || 'gsp_api_db',
        port: parseInt(process.env.GSP_DB_PORT || '5432', 10),
        database: process.env.GSP_DB_NAME || 'gsp_api_db',
        user: process.env.GSP_DB_USER || 'root',
        password: process.env.GSP_DB_PASSWORD || 'rootpassword',
    },
    pool: { min: 2, max: 10 }
});

/**
 * Synchronize generated/rotated/updated API keys to both the Main DB external tables
 * and GSP API DB tables so they mirror in real-time.
 */
const syncKeysToAllDbs = async (workspaceId, tenantId, productionKey, sandboxKey, status = 'active', mode = 'live') => {
    try {
        const workspace = await knex('workspaces').where({ id: workspaceId }).first();
        const clientName = workspace ? workspace.name : `Workspace ${workspaceId}`;
        const email = workspace?.settings?.email || `${workspaceId}@saas.com`;
        const mappedStatus = status === 'active' ? 'active' : 'inactive';

        const dbs = [
            { name: 'GSP DB', client: gspDb }
        ];

        for (const db of dbs) {
            try {
                // Find existing access key by third_party_unique_id
                const existing = await db.client('api_conn_access_key')
                    .where({ third_party_unique_id: workspaceId })
                    .first();

                let clientRecordId;

                if (existing) {
                    clientRecordId = existing.id;
                    // Delete old allowed accesses
                    await db.client('api_conn_allowed_access')
                        .whereIn('api_key', [existing.production_key, existing.app_secret_key])
                        .delete();

                    // Update access key
                    await db.client('api_conn_access_key')
                        .where({ id: clientRecordId })
                        .update({
                            client_name: clientName,
                            contact_email: email,
                            production_key: productionKey,
                            app_secret_key: sandboxKey,
                            status: mappedStatus,
                            mode: 'PRODUCTION',
                            updated_at: db.client.fn.now()
                        });
                } else {
                    const id = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();
                    const [inserted] = await db.client('api_conn_access_key')
                        .insert({
                            id,
                            platform: 'TENANT_PORTAL',
                            client_name: clientName,
                            contact_email: email,
                            third_party_unique_id: workspaceId,
                            production_key: productionKey,
                            app_secret_key: sandboxKey,
                            status: mappedStatus,
                            mode: 'PRODUCTION',
                            created_at: db.client.fn.now(),
                            updated_at: db.client.fn.now()
                        })
                        .returning('id');
                    clientRecordId = inserted?.id || id;
                }

                // Insert allowed accesses
                const allowedAccessRecords = [
                    {
                        api_key: productionKey,
                        service_gst: true,
                        total_gst_api_call: 100000,
                        remaining_gst_api_call: 100000,
                        service_eway_bill: true,
                        total_eway_bill_api_call: 100000,
                        remaining_eway_bill_api_call: 100000,
                        service_einvoice: true,
                        total_einvoice_api_call: 100000,
                        remaining_einvoice_api_call: 100000,
                        status: mappedStatus
                    },
                    {
                        api_key: sandboxKey,
                        service_gst: true,
                        total_gst_api_call: 100000,
                        remaining_gst_api_call: 100000,
                        service_eway_bill: true,
                        total_eway_bill_api_call: 100000,
                        remaining_eway_bill_api_call: 100000,
                        service_einvoice: true,
                        total_einvoice_api_call: 100000,
                        remaining_einvoice_api_call: 100000,
                        status: mappedStatus
                    }
                ];

                await db.client('api_conn_allowed_access').insert(allowedAccessRecords);
                console.log(`[Sync] Synced keys to ${db.name} for workspace ${workspaceId}`);
            } catch (err) {
                console.error(`[Sync] Failed sync to ${db.name} for workspace ${workspaceId}:`, err.message);
            }
        }
    } catch (globalErr) {
        console.error(`[Sync Error] Sync failed for workspace ${workspaceId}:`, globalErr.message);
    }
};

const deleteSyncKeys = async (workspaceId) => {
    const dbs = [
        { name: 'GSP DB', client: gspDb }
    ];

    for (const db of dbs) {
        try {
            const existing = await db.client('api_conn_access_key')
                .where({ third_party_unique_id: workspaceId })
                .first();

            if (existing) {
                await db.client('api_conn_allowed_access')
                    .whereIn('api_key', [existing.production_key, existing.app_secret_key])
                    .delete();

                await db.client('api_conn_access_key')
                    .where({ id: existing.id })
                    .delete();
            }
            console.log(`[Sync Delete] Cleaned up synced keys from ${db.name} for workspace ${workspaceId}`);
        } catch (err) {
            console.error(`[Sync Delete] Failed sync cleanup for ${db.name}:`, err.message);
        }
    }
};

/**
 * Get the API key record for a workspace (or null if none exists).
 */
const getByWorkspace = async (workspaceId, tenantId) => {
    return knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .select(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'third_party_name', 'extrainfo', 'created_at', 'updated_at'])
        .first();
};

/**
 * Create API keys for a workspace (one-time setup, SUPER_ADMIN only).
 * Generates both production_key and sandbox_key.
 */
const createKeys = async (workspaceId, tenantId, thirdPartyName = null, extraInfo = null) => {
    const workspace = await knex('workspaces').where({ id: workspaceId }).first();
    const gstin = workspace ? workspace.gstn : '';

    let productionKey, sandboxKey;
    let resolvedExtraInfo = extraInfo;

    if (thirdPartyName && thirdPartyName.toLowerCase().includes('adesk')) {
        const extra = extraInfo ? (typeof extraInfo === 'string' ? JSON.parse(extraInfo) : extraInfo) : {};
        const projectCode = extra.project_code || extra.projectCode || tenantId;
        const orgCode = extra.org_code || extra.orgCode || workspaceId;

        productionKey = Buffer.from(`${projectCode}@@${orgCode}@@${gstin}`).toString('base64');
        sandboxKey = Buffer.from(`${projectCode}@@${orgCode}@@${gstin}_sandbox`).toString('base64');

        extra.project_code = projectCode;
        extra.org_code = orgCode;
        extra.adesk_api_key = productionKey;
        resolvedExtraInfo = extra;
    } else {
        productionKey = generateKey();
        sandboxKey = generateKey();
    }

    const [record] = await knex('workspace_api_keys')
        .insert({
            workspace_id: workspaceId,
            tenant_id: tenantId,
            production_key: productionKey,
            sandbox_key: sandboxKey,
            status: 'active',
            mode: 'live',
            third_party_name: thirdPartyName,
            extrainfo: resolvedExtraInfo ? (typeof resolvedExtraInfo === 'object' ? JSON.stringify(resolvedExtraInfo) : resolvedExtraInfo) : null
        })
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'third_party_name', 'extrainfo', 'created_at']);

    await syncKeysToAllDbs(workspaceId, tenantId, productionKey, sandboxKey, 'active', 'live');

    return record;
};

/**
 * Update status (active/inactive) or mode (live/demo).
 */
const updateKeys = async (workspaceId, tenantId, { status, mode, third_party_name, extrainfo }) => {
    const updates = { updated_at: knex.fn.now() };
    if (status !== undefined) updates.status = status;
    if (mode !== undefined) updates.mode = mode;
    if (third_party_name !== undefined) updates.third_party_name = third_party_name;
    if (extrainfo !== undefined) updates.extrainfo = extrainfo ? (typeof extrainfo === 'object' ? JSON.stringify(extrainfo) : extrainfo) : null;

    const [updated] = await knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .update(updates)
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'third_party_name', 'extrainfo', 'updated_at']);

    if (updated) {
        await syncKeysToAllDbs(workspaceId, tenantId, updated.production_key, updated.sandbox_key, updated.status, updated.mode);
    }

    return updated || null;
};

/**
 * Regenerate both keys (or just one) for a workspace.
 */
const regenerateKeys = async (workspaceId, tenantId, which = 'both') => {
    const updates = { updated_at: knex.fn.now() };

    // We fetch current record to preserve the key that is not being regenerated
    const current = await getByWorkspace(workspaceId, tenantId);
    let productionKey = current?.production_key;
    let sandboxKey = current?.sandbox_key;

    const thirdPartyName = current?.third_party_name;
    const extraInfo = current?.extrainfo;
    const workspace = await knex('workspaces').where({ id: workspaceId }).first();
    const gstin = workspace ? workspace.gstn : '';

    const generateKeyForWorkspace = (isSandbox = false) => {
        if (thirdPartyName && thirdPartyName.toLowerCase().includes('adesk')) {
            const extra = extraInfo ? (typeof extraInfo === 'string' ? JSON.parse(extraInfo) : extraInfo) : {};
            const projectCode = extra.project_code || extra.projectCode || tenantId;
            const orgCode = extra.org_code || extra.orgCode || workspaceId;
            const suffix = isSandbox ? '_sandbox' : '';
            return Buffer.from(`${projectCode}@@${orgCode}@@${gstin}${suffix}`).toString('base64');
        }
        return generateKey();
    };

    let extra = null;
    if (thirdPartyName && thirdPartyName.toLowerCase().includes('adesk')) {
        extra = extraInfo ? (typeof extraInfo === 'string' ? JSON.parse(extraInfo) : extraInfo) : {};
    }

    if (which === 'both' || which === 'production') {
        productionKey = generateKeyForWorkspace(false);
        updates.production_key = productionKey;
        if (extra) {
            extra.adesk_api_key = productionKey;
        }
    }
    if (which === 'both' || which === 'sandbox') {
        sandboxKey = generateKeyForWorkspace(true);
        updates.sandbox_key = sandboxKey;
    }

    if (extra) {
        updates.extrainfo = JSON.stringify(extra);
    }

    const [updated] = await knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .update(updates)
        .returning(['id', 'tenant_id', 'workspace_id', 'status', 'mode', 'production_key', 'sandbox_key', 'third_party_name', 'extrainfo', 'updated_at']);

    if (updated) {
        await syncKeysToAllDbs(workspaceId, tenantId, updated.production_key, updated.sandbox_key, updated.status, updated.mode);
    }

    return updated || null;
};

/**
 * Delete the API key record for a workspace entirely.
 */
const deleteKeys = async (workspaceId, tenantId) => {
    const count = await knex('workspace_api_keys')
        .where({ workspace_id: workspaceId, tenant_id: tenantId })
        .delete();

    await deleteSyncKeys(workspaceId);

    return count;
};

/**
 * Validate an inbound key (used by the import middleware).
 * Returns { workspaceId, tenantId, mode } if valid, null otherwise.
 */
const validateKey = async (inboundKey) => {
    if (!inboundKey) return null;

    // 1. Try to validate as Hexadecimal key first
    const record = await knex('workspace_api_keys')
        .where(function () {
            this.where('production_key', inboundKey).orWhere('sandbox_key', inboundKey);
        })
        .where({ status: 'active' })
        .select(['id', 'workspace_id', 'tenant_id', 'mode', 'production_key'])
        .first();

    if (record) {
        const isProduction = record.production_key === inboundKey;
        return {
            keyId: record.id,
            workspaceId: record.workspace_id,
            tenantId: record.tenant_id,
            mode: isProduction ? 'live' : 'demo',
            keyType: isProduction ? 'production' : 'sandbox'
        };
    }

    // 2. Try to validate as raw or Base64 encoded key (tenant_id@@workspace_id@@gstin)
    try {
        let decoded = inboundKey;
        if (!inboundKey.includes('@@')) {
            try {
                decoded = Buffer.from(inboundKey, 'base64').toString('ascii');
            } catch (err) {
                // Not valid base64
            }
        }
        const parts = decoded.split('@@');
        if (parts.length === 3) {
            const [tenantId, workspaceId, gstin] = parts;
            let keyRecord = await knex('workspace_api_keys')
                .where({ workspace_id: workspaceId, tenant_id: tenantId, status: 'active' })
                .first();

            if (!keyRecord) {
                // Check if tenantId matches project_code and workspaceId matches org_code inside extrainfo JSONB
                keyRecord = await knex('workspace_api_keys')
                    .where({ status: 'active' })
                    .andWhere(function () {
                        this.whereRaw("extrainfo->>'project_code' = ?", [tenantId])
                            .andWhereRaw("extrainfo->>'org_code' = ?", [workspaceId]);
                    })
                    .first();
            }

            if (keyRecord) {
                const isProduction = !decoded.endsWith('_sandbox');
                return {
                    keyId: keyRecord.id,
                    workspaceId: keyRecord.workspace_id,
                    tenantId: keyRecord.tenant_id,
                    mode: keyRecord.mode === 'live' ? 'live' : 'demo',
                    keyType: isProduction ? 'production' : 'sandbox'
                };
            }
        }
    } catch (e) {
        // Query failed
    }

    return null;
};

const getGspSession = async (gstin, gstUsername) => {
    try {
        return await gspDb('ext_gstn_auth_sessions')
            .where({ gstin, gst_username: gstUsername, is_active: true })
            .where('token_expiry', '>', new Date())
            .orderBy('created_at', 'desc')
            .first();
    } catch (err) {
        console.error('[getGspSession] Failed to fetch GSP session:', err.message);
        return null;
    }
};

module.exports = { getByWorkspace, createKeys, updateKeys, regenerateKeys, deleteKeys, validateKey, syncKeysToAllDbs, getGspSession };
