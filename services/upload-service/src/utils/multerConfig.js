const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = '/app/uploads'; // Absolute path mapped in Docker
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            console.log('Creating upload directory:', uploadDir);
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
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
            cb(new Error(`Invalid file type: ${file.mimetype}. Only Excel/CSV files are allowed.`), false);
        }
    }
});

module.exports = upload;
