const express = require('express');
const router = express.Router();
const rcmLiabilityController = require('../controllers/rcmLiabilityController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

router.use(verifyToken);
router.use(authorizeWorkspace);

// RCM Liabilities
router.get('/', rcmLiabilityController.listLiabilities);
router.post('/:id/pay', rcmLiabilityController.payLiability);

module.exports = router;
