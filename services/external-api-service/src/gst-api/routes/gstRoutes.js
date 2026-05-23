const express = require('express');
const router = express.Router();
const controller = require('../controller/gstController');
const apiKeyAuth = require('../../middleware/apiKeyAuth');
const auditLogger = require('../../middleware/auditLogger');
const { clientLimiter } = require('../../middleware/rateLimiter');

// Apply audit logging to all GST routes
router.use(auditLogger('GST'));

// ─────────────────────────────────────────────────────────────
// CLIENT REGISTRATION (no API key needed — this is how they get one)
// ─────────────────────────────────────────────────────────────
/**
 * POST /ext/gst/clients
 * Register a new API client. Returns api_key.
 * Body: { client_name, contact_email }
 */
router.post('/clients', controller.registerClient);

// ─────────────────────────────────────────────────────────────
// All routes below require a valid API key and library authorization
// ─────────────────────────────────────────────────────────────
router.use(apiKeyAuth('GST'));
router.use(clientLimiter);

/**
 * POST /ext/gst/clients/gstins
 * Register a GSTIN under the API client account
 * Body: { gstin, gst_username, state_code, legal_name }
 */
router.post('/clients/gstins', controller.registerClientGstin);

// ─────────────────────────────────────────────────────────────
// PUBLIC GST APIs (no OTP auth needed)
// ─────────────────────────────────────────────────────────────

/**
 * GET /ext/gst/search?gstin=27AAGCB1286Q1Z4
 * Search taxpayer details by GSTIN (cached 24h)
 */
router.get('/search', controller.searchTaxpayer);

/**
 * GET /ext/gst/rettrack?gstin=27AAGCB...&fy=2023-24&type=R1
 * View and track return filing history
 */
router.get('/rettrack', controller.trackReturns);

/**
 * GET /ext/gst/preferences?gstin=27AAGCB...&fy=2023-24
 * Get filing preferences for a GSTIN
 */
router.get('/preferences', controller.getPreferences);

// ─────────────────────────────────────────────────────────────
// AUTHENTICATED GST APIs (OTP flow required)
// ─────────────────────────────────────────────────────────────

/**
 * POST /ext/gst/auth/otp-request
 * Initiate OTP for a registered GSTIN
 * Body: { gstin, gst_username }
 */
router.post('/auth/otp-request', controller.requestOtp);

/**
 * POST /ext/gst/auth/verify-otp
 * Verify OTP and store auth session for the GSTIN
 * Body: { gstin, gst_username, otp, txn }
 */
router.post('/auth/verify-otp', controller.verifyOtp);

module.exports = router;
