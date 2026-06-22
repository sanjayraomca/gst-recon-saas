const multer = require('multer');
const path = require('path');
const FormData = require('form-data');
const http = require('http');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

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
        if (['.csv', '.xlsx', '.xls', '.json'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .csv, .xlsx, .xls, and .json files are allowed'), false);
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

const { importBookData } = require('./bookImportConnectorController');

const logBookActivity = async (req, status, actionType, details) => {
    try {
        const context = req.connectorContext || {};
        const apiKey = req.headers['x-api-key'] || req.headers['api_key'] || null;
        let keyExcerpt = null;
        if (apiKey) {
            keyExcerpt = apiKey.length > 8 ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : '***';
        }

        const fileInfo = req.file ? {
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        } : null;

        await logActivity({
            userId: null,
            tenantId: context.tenantId || null,
            workspaceId: context.workspaceId || null,
            actionType,
            entityType: 'BookDataFile',
            details: {
                status,
                path: req.originalUrl || req.path,
                error: (details && details.error) || null,
                key_excerpt: keyExcerpt,
                type: req.body ? req.body.type : null,
                return_period: req.body ? req.body.return_period : null,
                mode: context.mode || null,
                key_type: context.keyType || null,
                file_info: fileInfo,
                ...details
            },
            req
        });
    } catch (e) {
        console.error('[logBookActivity] Failed to log activity:', e.message);
    }
};

// ─── Main handler ─────────────────────────────────────────────────────────────
const importBookFile = async (req, res) => {
    try {
        const { workspaceId, tenantId, mode, keyType } = req.connectorContext;

        // Check if this is a raw JSON payload request or a JSON file upload
        const isJsonRequest = req.headers['content-type']?.includes('application/json');
        const isJsonFile = req.file && path.extname(req.file.originalname).toLowerCase() === '.json';

        if (isJsonRequest || isJsonFile) {
            if (isJsonFile) {
                try {
                    const fileContent = req.file.buffer.toString('utf8');
                    const parsed = JSON.parse(fileContent);
                    
                    // Merge fields parsed from JSON file into req.body dynamically
                    if (parsed) {
                        if (Array.isArray(parsed)) {
                            req.body.records = parsed;
                        } else {
                            if (parsed.records) req.body.records = parsed.records;
                            if (parsed.type) req.body.type = parsed.type;
                            if (parsed.return_period) req.body.return_period = parsed.return_period;
                        }
                    }
                } catch (parseErr) {
                    await logBookActivity(req, 'Failed', 'CONNECTOR_FILE_IMPORT_PARSE_ERROR', { error: `Failed to parse uploaded JSON file: ${parseErr.message}` });
                    return errorResponse(res, `Failed to parse uploaded JSON file: ${parseErr.message}`, 400);
                }
            }

            // Delegate dynamically to importBookData to leverage its robust schema validation, DB ingestion, and activity logs!
            return await importBookData(req, res);
        }

        if (!req.file) {
            await logBookActivity(req, 'Failed', 'CONNECTOR_FILE_IMPORT_MISSING_FILE', { error: 'No file uploaded' });
            return errorResponse(res, 'No file uploaded. Send file as form-data with field name "file" or send a valid JSON request.', 400);
        }

        const rawType = req.body.type || 'purchase_register';
        const uploadType = TYPE_MAP[rawType.toLowerCase()] || 'PURCHASE';

        const now = new Date();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const resolvedPeriod = req.body.return_period || `${mm}${yyyy}`;

        console.log(`[ConnectorProxy] Forwarding ${req.file.originalname} (${req.file.size} bytes) → upload-service as type=${uploadType}`);

        // Forward to upload-service internal endpoint
        const result = await forwardToUploadService(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
            {
                type:          uploadType,
                return_period: resolvedPeriod.toString()
            },
            {
                'x-tenant-id':          tenantId,
                'x-workspace-id':       workspaceId,
                'x-connector-mode':     mode,
                'x-connector-key-type': keyType
            }
        );

        // Log result of proxy forwarding
        if (result.statusCode >= 200 && result.statusCode < 300) {
            await logBookActivity(req, 'Success', 'CONNECTOR_FILE_IMPORT_SUCCESS', {
                upload_service_response: result.body
            });
        } else {
            await logBookActivity(req, 'Failed', 'CONNECTOR_FILE_IMPORT_SERVICE_ERROR', {
                statusCode: result.statusCode,
                error: result.body
            });
        }

        // Pass upload-service response straight back to the ERP caller
        return res.status(result.statusCode).json(result.body);

    } catch (err) {
        console.error('[ConnectorProxy.importBookFile]', err.message);
        await logBookActivity(req, 'Failed', 'CONNECTOR_FILE_IMPORT_EXCEPTION', { error: err.message });
        return errorResponse(res, `Failed to forward request to import service: ${err.message}`, 502);
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    importBookFile
};
