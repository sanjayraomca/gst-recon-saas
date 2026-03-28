const express = require('express');
const router = express.Router();
const itcDecisionController = require('../controllers/itcDecisionController');
const itcReversalController = require('../controllers/itcReversalController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

router.use(verifyToken);
router.use(authorizeWorkspace);

// ITC Decisions
router.get('/itc-decisions', itcDecisionController.listDecisions);
router.put('/itc-decisions/:id', itcDecisionController.updateDecision);

// ITC Reversals
router.get('/itc-reversals', itcReversalController.listReversals);
router.post('/itc-reversals/:id/reclaim', itcReversalController.reclaimReversal);

module.exports = router;
