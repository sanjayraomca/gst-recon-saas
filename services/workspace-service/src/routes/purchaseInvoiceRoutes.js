const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    getAllInvoices,
    getInvoiceById,
    createInvoice,
    updateInvoice,
    amendInvoice
} = require('../controllers/purchaseInvoiceController');

// All routes require authentication
router.use(verifyToken);

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
