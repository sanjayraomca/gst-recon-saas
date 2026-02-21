const express = require('express');
const router = express.Router();
const GSTRImportController = require('../controllers/gstrImportController');
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

// Get import history
router.get('/import/history', verifyToken, GSTRImportController.getImportHistory);

// Get specific import details
router.get('/import/:import_filing_id', verifyToken, GSTRImportController.getImportById);

module.exports = router;
