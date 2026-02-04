const Upload = require('../models/upload');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { publishEvent } = require('../nats/natsClient');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        console.log('Multer Destination called');
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
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { upload_type, gstin_id, period_code } = req.body;
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId || !upload_type || !period_code) {
            // Cleanup uploaded file if validation fails
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Missing required fields: workspace_id, upload_type, period_code' });
        }

        const stats = fs.statSync(req.file.path);

        // Generate Hash
        const fileBuffer = fs.readFileSync(req.file.path);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');

        const newUpload = await Upload.create({
            id: uuidv4(),
            workspace_id: workspaceId,
            gstin_id: gstin_id || null, // Optional - can be null for workspace-level uploads
            file_name: req.file.originalname,
            original_file_name: req.file.originalname,
            storage_path: req.file.path,
            file_size_bytes: stats.size,
            file_hash: hex,
            mime_type: req.file.mimetype,
            upload_type,
            upload_status: 'PENDING',
            uploaded_by: req.user ? req.user.id : null,
            uploaded_at: new Date(),
            metadata: { period: period_code }
        });

        // Publish Event for Processing
        publishEvent('FILE_UPLOADED', {
            upload_id: newUpload.id,
            path: newUpload.storage_path,
            type: upload_type,
            workspace_id: workspaceId
        });

        return successResponse(res, newUpload, 'File uploaded successfully');
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return errorResponse(res, error);
    }
};

const listUploads = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const { page = 1, page_size = 20, status, upload_type, gstin_id } = req.query;

        if (!workspaceId) return res.status(400).json({ error: 'Workspace ID required' });

        const uploads = await Upload.findAll(
            { workspace_id: workspaceId, status, upload_type, gstin_id },
            { page, page_size }
        );

        return successResponse(res, uploads, 'Uploads fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getUpload = async (req, res) => {
    try {
        const { id } = req.params;
        const upload = await Upload.findById(id);
        if (!upload) return res.status(404).json({ error: 'Upload not found' });
        return successResponse(res, upload, 'Upload details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    uploadFile,
    listUploads,
    getUpload
};
