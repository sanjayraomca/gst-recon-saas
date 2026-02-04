const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// All tenant routes require authentication
router.use(verifyToken);

router.post('/', tenantController.createTenant);
router.get('/', tenantController.listTenants);
router.get('/:id', tenantController.getTenant);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);

module.exports = router;
