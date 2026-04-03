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

// GET /suppliers/filing-status - Get suppliers with their last filing status
router.get('/filing-status', verifyToken, authorizeWorkspace, supplierController.getFilingStatusListing);

// GET /suppliers/:gstin/filing-history - Get month-wise filing history for a specific supplier
router.get('/:gstin/filing-history', verifyToken, authorizeWorkspace, supplierController.getFilingHistory);

// PATCH /suppliers/:id - Update supplier contact details
router.patch('/:id', verifyToken, authorizeWorkspace, supplierController.updateSupplierContact);

module.exports = router;
