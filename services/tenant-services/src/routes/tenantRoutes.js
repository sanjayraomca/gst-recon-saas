const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Public route for tenant registration
router.post('/signup', tenantController.registerTenant);

// All other tenant routes require authentication
router.use(verifyToken);

router.post('/', tenantController.createTenant);
router.get('/stats/global', tenantController.getGlobalStats);
router.get('/', tenantController.listTenants);
router.get('/:id', tenantController.getTenant);
router.get('/:id/workspaces', tenantController.listTenantWorkspaces);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);

// User Management Routes
router.post('/:id/users', tenantController.provisionUser);
router.get('/:id/users', tenantController.listTenantUsers);
router.post('/:id/users/:userId/resend', tenantController.resendInvite);
router.put('/:id/users/:userId/role', tenantController.updateUserRole);
router.put('/:id/users/:userId', tenantController.updateUser);
router.delete('/:id/users/:userId', tenantController.deleteUserRole);

// Activity Logs Route
router.get('/:tenantId/activities', tenantController.getTenantActivities);

// Stats Route
router.get('/:id/stats', tenantController.getTenantStats);

// Permissions Sync Routes
router.put('/:id/role-permissions', tenantController.updateRolePermissions);
router.get('/:id/role-permissions', tenantController.getRolePermissions);

module.exports = router;

