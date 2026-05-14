const multer = require('multer');
const path = require('path');
const FormData = require('form-data');
const http = require('http');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * bookFileImportConnectorController
 *
 * PROXY ONLY — no import logic here.
 *
 * 1. Validates API key (done by apiKeyMiddleware before this runs)
 * 2. Receives the file via multer (memory storage)
 * 3. Forwards the file + context headers to upload-service
 *    POST http://upload-service:3004/book-import/internal/upload
 * 4. Returns upload-service's response back to the ERP caller
 *
 * All validation, processing, DB writes, NATS events and audit logging
 * are handled by the existing BookModel + GSTRImportModel in upload-service.
 * Zero logic duplication.
 *
 * Route: POST /connectors/book-import/file
 * Auth:  X-API-Key header (resolved by apiKeyMiddleware)
 *
 * Form-data fields:
 *   file          — the .csv or .xlsx file
 *   type          — PURCHASE | SALES | PURCHASE_RETURN | SALES_RETURN
 *   return_period — MMYYYY (e.g. 042025)
 */

const UPLOAD_SERVICE_HOST = process.env.UPLOAD_SERVICE_HOST || 'upload-service';
const UPLOAD_SERVICE_PORT = parseInt(process.env.UPLOAD_SERVICE_PORT || '3004', 10);
const INTERNAL_ENDPOINT   = '/book-import/internal/upload';

// ─── multer: memory storage ──────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .csv, .xlsx, and .xls files are allowed'), false);
        }
    }
});

const TYPE_MAP = {
    purchase_register: 'PURCHASE',
    purchase_return:   'PURCHASE_RETURN',
    sales_register:    'SALES',
    sales_return:      'SALES_RETURN'
};

// ─── Forward to upload-service via multipart/form-data ───────────────────────
const forwardToUploadService = (fileBuffer, filename, mimetype, fields, contextHeaders) => {
    return new Promise((resolve, reject) => {
        const form = new FormData();

        // Attach file
        form.append('file', fileBuffer, {
            filename,
            contentType: mimetype || 'application/octet-stream'
        });

        // Attach form fields
        for (const [key, val] of Object.entries(fields)) {
            form.append(key, val);
        }

        const formHeaders = form.getHeaders();

        const options = {
            hostname: UPLOAD_SERVICE_HOST,
            port:     UPLOAD_SERVICE_PORT,
            path:     INTERNAL_ENDPOINT,
            method:   'POST',
            headers: {
                ...formHeaders,
                ...contextHeaders,
                'x-internal-service': 'connector'  // service-to-service auth
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body });
                }
            });
        });

        req.on('error', reject);
        form.pipe(req);
    });
};

// ─── Main handler ─────────────────────────────────────────────────────────────
const importBookFile = async (req, res) => {
    try {
        const { workspaceId, tenantId, mode, keyType } = req.connectorContext;

        if (!req.file) {
            return errorResponse(res, 'No file uploaded. Send file as form-data with field name "file"', 400);
        }

        const { type, return_period } = req.body;

        if (!type || !TYPE_MAP[type.toLowerCase()]) {
            return errorResponse(res, `type must be one of: ${Object.keys(TYPE_MAP).join(', ')}`, 400);
        }
        if (!return_period) {
            return errorResponse(res, 'return_period is required (MMYYYY format, e.g. 042025)', 400);
        }

        const uploadType = TYPE_MAP[type.toLowerCase()];

        console.log(`[ConnectorProxy] Forwarding ${req.file.originalname} (${req.file.size} bytes) → upload-service as type=${uploadType}`);

        // Forward to upload-service internal endpoint
        const result = await forwardToUploadService(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            {
                type:          uploadType,
                return_period: return_period.toString()
            },
            {
                'x-tenant-id':          tenantId,
                'x-workspace-id':       workspaceId,
                'x-connector-mode':     mode,
                'x-connector-key-type': keyType
            }
        );

        // Pass upload-service response straight back to the ERP caller
        return res.status(result.statusCode).json(result.body);

    } catch (err) {
        console.error('[ConnectorProxy.importBookFile]', err.message);
        return errorResponse(res, `Failed to forward request to import service: ${err.message}`, 502);
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    importBookFile
};
