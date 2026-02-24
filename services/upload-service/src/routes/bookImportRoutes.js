const express = require('express');
const router = express.Router();
const BookImportController = require('../controllers/bookImportController');
const upload = require('../utils/multerConfig');
const authMiddleware = require('../../../shared/src/middleware/authMiddleware'); // Verify path

// Apply Auth Middleware
router.use(authMiddleware.verifyToken);

// Sales Register Upload Route
router.post('/sales/upload', upload.single('file'), BookImportController.uploadSalesBook);

// Purchase Register Upload Route
router.post('/purchase/upload', upload.single('file'), BookImportController.uploadPurchaseBook);

// Sales Return Upload Route
router.post('/sales-return/upload', upload.single('file'), BookImportController.uploadSalesReturn);

// Purchase Return Upload Route
router.post('/purchase-return/upload', upload.single('file'), BookImportController.uploadPurchaseReturn);

module.exports = router;
