const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

// Base path: /workspaces (mounted in index.js)

router.post('/', verifyToken, workspaceController.createWorkspace);
router.get('/', verifyToken, workspaceController.listWorkspaces);
router.get('/:id', verifyToken, authorizeWorkspace, workspaceController.getWorkspace);
router.get('/:id/dashboard-metrics', verifyToken, authorizeWorkspace, workspaceController.getDashboardMetrics);
router.get('/:id/sidebar-counts', verifyToken, authorizeWorkspace, workspaceController.getSidebarCounts);
router.get('/:id/latest-period', verifyToken, authorizeWorkspace, workspaceController.getLatestPeriod);
router.get('/:id/tax-periods', verifyToken, authorizeWorkspace, workspaceController.getTaxPeriods);
router.get('/:id/data-date-range', verifyToken, authorizeWorkspace, workspaceController.getDataDateRange);
router.get('/:id/users', verifyToken, authorizeWorkspace, workspaceController.listWorkspaceUsers);
router.post('/:id/users/invite', verifyToken, authorizeWorkspace, workspaceController.inviteUser);
router.put('/:id', verifyToken, authorizeWorkspace, workspaceController.updateWorkspace);

module.exports = router;
