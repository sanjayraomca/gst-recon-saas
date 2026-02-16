const express = require('express');
const router = express.Router();
const GSTR2BController = require('../controllers/gstr2bController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const multer = require('multer');
const fs = require('fs');

// Configure Multer for GSTR-2B
const storage = multer.diskStorage({
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

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Routes
router.post('/upload', verifyToken, upload.single('file'), GSTR2BController.uploadGSTR2B);
router.get('/history', verifyToken, GSTR2BController.getImportHistory);

module.exports = router;
