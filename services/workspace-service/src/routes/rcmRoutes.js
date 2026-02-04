const express = require('express');
const router = express.Router();
const rcmLiabilityController = require('../controllers/rcmLiabilityController');

// RCM Liabilities
router.get('/', rcmLiabilityController.listLiabilities);
router.post('/:id/pay', rcmLiabilityController.payLiability);

module.exports = router;
