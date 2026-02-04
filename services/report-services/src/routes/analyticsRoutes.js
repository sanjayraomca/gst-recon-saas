const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

router.get('/compliance', analyticsController.getComplianceOverview);
router.get('/itc-summary', analyticsController.getITCSummary);

module.exports = router;
