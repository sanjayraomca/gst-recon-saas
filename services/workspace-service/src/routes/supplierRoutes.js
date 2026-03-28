const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

/**
 * Supplier Routes
 * All routes require authentication and workspace authorization
 */

// GET /suppliers - List all suppliers for a workspace
router.get('/', verifyToken, authorizeWorkspace, supplierController.getAllSuppliers);

module.exports = router;
