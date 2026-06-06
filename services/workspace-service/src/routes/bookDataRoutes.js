const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { getBookData, getBookDataSummary, getBookDataById, getBookDataMasters, deleteBookDataById } = require('../controllers/bookDataController');
const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

router.use(verifyToken);
router.use(authorizeWorkspace);

// GET /book-data/summary?period=2024-11  — returns aggregate totals for all 9 types
router.get('/summary', getBookDataSummary);

// GET /book-data/masters?type=sales_invoice — returns unique gstins/parties
router.get('/masters', getBookDataMasters);

// GET /book-data/voucher/:id — returns a single book entry
router.get('/voucher/:id', getBookDataById);

// DELETE /book-data/voucher/:id — deletes a book entry and logs it to deleted_invoices
router.delete('/voucher/:id', deleteBookDataById);

// GET /book-data?type=sales_invoice&period=2024-11&search=...&status=DRAFT&page=1&page_size=50
router.get('/', getBookData);


module.exports = router;

