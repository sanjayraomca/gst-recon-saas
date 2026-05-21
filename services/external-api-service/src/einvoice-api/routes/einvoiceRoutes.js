const express = require('express');
const router = express.Router();
const controller = require('../controller/einvoiceController');
const apiKeyAuth = require('../../middleware/apiKeyAuth');
const auditLogger = require('../../middleware/auditLogger');
const rateLimiter = require('../../middleware/rateLimiter');

// Apply audit logging to all EINVOICE routes
router.use(auditLogger('EINVOICE'));

// Require valid API key with EINVOICE library authorization
router.use(apiKeyAuth('EINVOICE'));
router.use(rateLimiter);

router.post('/irn', controller.generateIrn);
router.get('/irn/:irn', controller.getIrnDetails);
router.post('/irn/cancel', controller.cancelIrn);
router.get('/hsnsum', controller.getHsnSummary);

module.exports = router;
