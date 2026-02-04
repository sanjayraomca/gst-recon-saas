const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// 6.1 Standard Reports
router.get('/itc-summary', reportController.getITCSummary);
router.get('/reconciliation-mismatches', reportController.getReconMismatches);
router.get('/compliance-score/:entity_type/:entity_id', reportController.getComplianceScore);
router.get('/cash-flow-impact', reportController.getCashFlowImpact);

// 6.2 Saved Reports & Scheduling
router.get('/saved', reportController.listSavedReports);
router.post('/saved', reportController.createSavedReport);
router.post('/saved/:report_id/generate', reportController.generateSavedReport);
router.get('/download/:generation_id', reportController.downloadReport);

module.exports = router;
