const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    getApiKeys,
    createApiKeys,
    updateApiKeys,
    regenerateApiKeys,
    deleteApiKeys,
    validateApiKey,
    requireSuperAdmin
} = require('./connectorController');

// ── PUBLIC ───────────────────────────────────────────────────────────────────
// No JWT — called directly by ERP connectors (Tally, Zoho, SAP, QuickBooks)
// to authenticate an inbound Purchase/Sales register push.
router.post('/validate-key', validateApiKey);


// ── PROTECTED (JWT required + SUPER_ADMIN only) ───────────────────────────────
// verifyToken → confirms WHO is asking
// requireSuperAdmin → confirms they hold SUPER_ADMIN role in the system
// The TARGET workspace is passed in body (POST/PATCH/DELETE) or query (GET)
// — not derived from X-Workspace-ID header.
router.use(verifyToken);
router.use(requireSuperAdmin);

/**
 * GET  /connectors/api-keys?tenant_id=xxx&workspace_id=yyy
 * Retrieve API keys for a specific organization.
 */
router.get('/api-keys', getApiKeys);

/**
 * POST /connectors/api-keys
 * Create production + sandbox keys for an organization.
 * Body: { tenant_id, workspace_id }
 */
router.post('/api-keys', createApiKeys);

/**
 * PATCH /connectors/api-keys
 * Update status or mode for an organization's keys.
 * Body: { tenant_id, workspace_id, status?, mode? }
 */
router.patch('/api-keys', updateApiKeys);

/**
 * POST /connectors/api-keys/regenerate
 * Rotate production_key, sandbox_key, or both.
 * Body: { tenant_id, workspace_id, which?: "production"|"sandbox"|"both" }
 */
router.post('/api-keys/regenerate', regenerateApiKeys);

/**
 * DELETE /connectors/api-keys
 * Permanently remove API keys for an organization.
 * Body: { tenant_id, workspace_id }
 */
router.delete('/api-keys', deleteApiKeys);

module.exports = router;
