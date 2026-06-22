const express = require('express');
const router = express.Router();
const JsonImportController = require('../controllers/jsonImportController');
const GstrJsonImportController = require('../controllers/gstrJsonImportController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Standard middleware for book data upload
// router.post('/book/sales/upload', verifyToken, JsonImportController.uploadSalesBook);
router.post('/book/sales/upload', verifyToken, JsonImportController.uploadSalesBook);
// router.post('/book/purchase/upload', verifyToken, JsonImportController.uploadPurchaseBook);
router.post('/book/purchase/upload', verifyToken, JsonImportController.uploadPurchaseBook);

// GSTR JSON upload
// router.post('/gstr/upload', verifyToken, GstrJsonImportController.uploadGstrJson);
router.post('/gstr/upload', verifyToken, GstrJsonImportController.uploadGstrJson);

module.exports = router;
