const express = require('express');
const router = express.Router();
const BookImportInternalController = require('../controllers/bookImportInternalController');
const upload = require('../utils/multerConfig');

/**
 * Internal Service-to-Service Routes
 *
 * These routes are NOT exposed via Traefik/public gateway.
 * They are only reachable by other containers on the Docker internal network.
 *
 * Protected by: x-internal-service: connector header
 * (Not JWT — called by workspace-service after API key validation)
 */

// Guard: reject any request without the internal service header
const requireInternalService = (req, res, next) => {
    if (req.headers['x-internal-service'] !== 'connector') {
        return res.status(403).json({ success: false, error: 'Forbidden — internal service routes only' });
    }
    next();
};

/**
 * POST /book-import/internal/upload
 *
 * Called by workspace-service connector endpoint.
 * Accepts file + context headers → runs full existing import pipeline.
 *
 * Headers required:
 *   x-internal-service: connector
 *   x-tenant-id:        <uuid>
 *   x-workspace-id:     <uuid>
 *   x-connector-mode:   live | demo
 *   x-connector-key-type: production | sandbox
 *
 * Body (multipart/form-data):
 *   file          — .csv or .xlsx
 *   type          — PURCHASE | SALES | PURCHASE_RETURN | SALES_RETURN
 *   return_period — MMYYYY
 */
router.post(
    '/upload',
    requireInternalService,
    upload.single('file'),
    BookImportInternalController.uploadInternal
);

module.exports = router;
