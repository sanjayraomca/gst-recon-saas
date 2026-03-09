const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { getBookData, getBookDataSummary, getBookDataById } = require('../controllers/bookDataController');

router.use(verifyToken);

// GET /book-data/summary?period=2024-11  — returns aggregate totals for all 9 types
router.get('/summary', getBookDataSummary);

// GET /book-data/voucher/:id — returns a single book entry
router.get('/voucher/:id', getBookDataById);

// GET /book-data?type=sales_invoice&period=2024-11&search=...&status=DRAFT&page=1&page_size=50
router.get('/', getBookData);

module.exports = router;

