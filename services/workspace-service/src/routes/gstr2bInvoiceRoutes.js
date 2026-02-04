const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    getAllInvoices,
    getInvoiceById
} = require('../controllers/gstr2bInvoiceController');

// All routes require authentication
router.use(verifyToken);

// GET /gstr2b-invoices - List all GSTR2B invoices with filters
router.get('/', getAllInvoices);

// GET /gstr2b-invoices/:id - Get single GSTR2B invoice
router.get('/:id', getInvoiceById);

module.exports = router;
