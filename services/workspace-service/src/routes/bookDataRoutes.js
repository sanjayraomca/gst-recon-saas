const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { getBookData } = require('../controllers/bookDataController');

router.use(verifyToken);

// GET /book-data?type=sales_invoice&period=2024-11&search=...&status=DRAFT&page=1&page_size=50
router.get('/', getBookData);

module.exports = router;
