const express = require('express');
const router = express.Router();
const GSTRImportController = require('../controllers/gstrImportController');
const GSTR2BController = require('../controllers/gstr2bController');
const BookImportController = require('../controllers/bookImportController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

/**
 * Configure Multer for Generic GSTR Import
 * Temporary storage before uploading to MinIO
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = '/app/uploads/gstr-imports';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `gstr-import-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Accept only Excel files
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'application/octet-stream', // fallback
            'text/csv',
            'application/csv'
        ];

        const isExcelExt = file.originalname.match(/\.(xlsx|xls|csv)$/i);
        const isExcelMime = allowedMimes.includes(file.mimetype);

        if (isExcelExt || isExcelMime) {
            cb(null, true);
        } else {
            console.error(`[DEBUG] Multer FileFilter rejected: name="${file.originalname}", mime="${file.mimetype}"`);
            cb(new Error(`Invalid file type: ${file.mimetype}. Only Excel/CSV files are allowed.`), false);
        }
    }
});

/**
 * Configure Multer for GSTR-2B specific legacy flow
 */
const gstr2bStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = '/app/uploads/gstr2b';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'gstr2b-' + uniqueSuffix + '-' + file.originalname);
    }
});
const gstr2bUpload = multer({
    storage: gstr2bStorage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

/**
 * Routes for GSTR Import
 */

// Wrap multer upload to handle errors and return 400 instead of 500
const uploadMiddleware = (req, res, next) => {
    console.log(`[DEBUG] Received upload request to ${req.originalUrl}`);
    upload.single('file')(req, res, function (err) {
        if (err) {
            console.error(`[DEBUG] Multer error: ${err.message}`);
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
        console.log(`[DEBUG] Multer successful for ${req.originalUrl}`);
        next();
    });
};

// Upload GSTR file (any type)
router.post('/import/upload', verifyToken, uploadMiddleware, GSTRImportController.uploadGSTRFile);

// Stream Server-Sent Events (SSE) for upload progress tracking
router.get('/import/progress', verifyToken, GSTRImportController.getUploadProgress);

// Get import history
router.get('/import/history', verifyToken, GSTRImportController.getImportHistory);

// Get active periods
router.get('/active-periods', verifyToken, GSTRImportController.getActivePeriods);

// Get dynamic filter options for multi-selects (Blueprint Rule 6)
router.get('/filter-options', verifyToken, GSTRImportController.getFilterOptions);

// Get specific import details
router.get('/import/:import_filing_id', verifyToken, GSTRImportController.getImportById);
router.delete('/import/:import_filing_id', verifyToken, GSTRImportController.deleteImport);

// Download original uploaded import file from MinIO
router.get('/import/download/:import_filing_id', verifyToken, GSTRImportController.downloadImportFile);

// ─── GSTR-2B Normalized Listing ─────────────────────────────────────────────
// Paginated invoice listing: GET /gst-import/gstr2b/list
//   Query: return_period, section, supplier_gstin, document_number, itc_available, page, page_size
router.get('/gstr2b/list', verifyToken, GSTRImportController.listGstr2bInvoices);

// Delete individual GSTR invoice
router.delete('/gstr/invoice/:id', verifyToken, GSTRImportController.deleteGstrInvoice);

// Section-level totals: GET /gst-import/gstr2b/summary
//   Query: return_period
router.get('/gstr2b/summary', verifyToken, GSTRImportController.getGstr2bSummary);

// Legacy GSTR-2B upload
router.post('/gstr2b/upload', verifyToken, gstr2bUpload.single('file'), GSTR2BController.uploadGSTR2B);

// Book Data (Sales/Purchase)
router.post('/book/sales/upload', verifyToken, upload.single('file'), BookImportController.uploadSalesBook);
router.post('/book/purchase/upload', verifyToken, upload.single('file'), BookImportController.uploadPurchaseBook);

module.exports = router;

