const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Base path: /workspaces (mounted in index.js)

router.post('/', verifyToken, workspaceController.createWorkspace);
router.get('/', verifyToken, workspaceController.listWorkspaces);
router.get('/:id', verifyToken, workspaceController.getWorkspace);
router.get('/:id/dashboard-metrics', verifyToken, workspaceController.getDashboardMetrics);
router.get('/:id/latest-period', verifyToken, workspaceController.getLatestPeriod);
router.get('/:id/tax-periods', verifyToken, workspaceController.getTaxPeriods);
router.get('/:id/data-date-range', verifyToken, workspaceController.getDataDateRange);
router.get('/:id/users', verifyToken, workspaceController.listWorkspaceUsers);
router.post('/:id/users/invite', verifyToken, workspaceController.inviteUser);
router.put('/:id', verifyToken, workspaceController.updateWorkspace);

module.exports = router;
