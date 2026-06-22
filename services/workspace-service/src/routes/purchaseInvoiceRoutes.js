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

// Third-party sync route:
// - If x-api-key header is present: no Bearer JWT needed (API key is self-contained auth)
// - If x-org-token or Bearer headers used: verifyToken applies
const optionalVerifyToken = (req, res, next) => {
    if (req.headers['x-api-key']) {
        // API key path — skip JWT verification entirely
        return next();
    }
    // All other paths require a valid Bearer JWT
    return verifyToken(req, res, next);
};
router.post('/third-party/sync', optionalVerifyToken, syncThirdPartyPurchases);


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
