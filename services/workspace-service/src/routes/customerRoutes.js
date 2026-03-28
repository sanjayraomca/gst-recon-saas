const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

/**
 * Customer Routes
 * All routes require authentication and workspace authorization
 */

// GET /customers - List all customers for a workspace
router.get('/', verifyToken, authorizeWorkspace, customerController.getAllCustomers);

// PATCH /customers/:id - Update customer contact details
router.patch('/:id', verifyToken, authorizeWorkspace, customerController.updateCustomerContact);

module.exports = router;
