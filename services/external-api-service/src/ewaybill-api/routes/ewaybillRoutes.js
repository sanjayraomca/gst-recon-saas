const express = require('express');
const router = express.Router();
const controller = require('../controller/ewaybillController');
const apiKeyAuth = require('../../middleware/apiKeyAuth');
const auditLogger = require('../../middleware/auditLogger');
const rateLimiter = require('../../middleware/rateLimiter');

// Apply audit logging to all EWAYBILL routes
router.use(auditLogger('EWAYBILL'));

// Require valid API key with EWAYBILL library authorization
router.use(apiKeyAuth('EWAYBILL'));
router.use(rateLimiter);

router.post('/', controller.generateEwb);
router.post('/cancel', controller.cancelEwb);
router.post('/vehicle', controller.updateVehicle);
router.get('/:ewbNo', controller.getEwbDetails);

module.exports = router;
