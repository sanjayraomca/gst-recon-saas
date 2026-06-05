const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    getAllInvoices,
    getInvoiceById,
    createInvoice,
    updateInvoice,
    amendInvoice,
    syncThirdPartyPurchases
} = require('../controllers/purchaseInvoiceController');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

// Third-party sync route (handles workspace resolution internally via headers)
router.post('/third-party/sync', verifyToken, syncThirdPartyPurchases);

// All routes require authentication and workspace authorization
router.use(verifyToken);
router.use(authorizeWorkspace);

// GET /purchase-invoices - List all invoices with filters
router.get('/', getAllInvoices);

// GET /purchase-invoices/:id - Get single invoice
router.get('/:id', getInvoiceById);

// POST /purchase-invoices - Create new invoice
router.post('/', createInvoice);

// PUT /purchase-invoices/:id - Update invoice
router.put('/:id', updateInvoice);

// POST /purchase-invoices/:id/amend - Create amendment
router.post('/:id/amend', amendInvoice);

module.exports = router;
