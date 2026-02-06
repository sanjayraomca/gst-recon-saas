const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Public route for tenant registration
router.post('/signup', tenantController.registerTenant);

// All other tenant routes require authentication
router.use(verifyToken);

router.post('/', tenantController.createTenant);
router.get('/', tenantController.listTenants);
router.get('/:id', tenantController.getTenant);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);

// User Management Routes
router.post('/:id/users', tenantController.provisionUser);
router.get('/:id/users', tenantController.listTenantUsers);

module.exports = router;
