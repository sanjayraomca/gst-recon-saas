const ConnectorModel = require('./connectorModel');
const { errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * Helper: Parse client credentials from the key defensively for logging
 */
const parseKeyDetails = (apiKey) => {
    if (!apiKey) return { tenantId: null, workspaceId: null, rawKeyExcerpt: null };
    
    // Create a safe excerpt for the log so we never log the actual full credential
    const rawKeyExcerpt = apiKey.length > 8 ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : '***';

    try {
        const decoded = Buffer.from(apiKey, 'base64').toString('ascii');
        const parts = decoded.split('@@');
        if (parts.length === 3) {
            return {
                tenantId: parts[0],
                workspaceId: parts[1],
                rawKeyExcerpt
            };
        }
    } catch (e) {
        // Not a base64 key
    }
    return { tenantId: null, workspaceId: null, rawKeyExcerpt };
};

/**
 * Helper: Log authentication attempt results (both success and fail) in activity_logs
 */
const logAuthActivity = async (req, status, actionType, errorMsg, keyInfo) => {
    try {
        const { tenantId, workspaceId, rawKeyExcerpt } = keyInfo;
        await logActivity({
            userId: null,
            tenantId,
            workspaceId,
            actionType,
            entityType: 'ApiKeyAuthentication',
            details: {
                status,
                error: errorMsg || null,
                key_excerpt: rawKeyExcerpt,
                path: req.originalUrl || req.path
            },
            req
        });
    } catch (e) {
        console.error('[logAuthActivity] Failed to log activity:', e.message);
    }
};

/**
 * apiKeyMiddleware
 *
 * Reads X-API-Key from the request header, validates it against workspace_api_keys,
 * and attaches the resolved context to req.connectorContext.
 *
 * Used by all inbound ERP connector endpoints (e.g. POST /connectors/book-import).
 * No JWT is required — the API key IS the authentication credential.
 *
 * Sets on success:
 *   req.connectorContext = { keyId, workspaceId, tenantId, mode, keyType }
 *     mode    → "live" | "demo"
 *     keyType → "production" | "sandbox"
 */
const validateApiKeyMiddleware = async (req, res, next) => {
    let apiKey = null;
    try {
        apiKey = req.headers['x-api-key'] || req.headers['api_key'];

        if (!apiKey) {
            const keyInfo = { tenantId: null, workspaceId: null, rawKeyExcerpt: null };
            await logAuthActivity(req, 'Failed', 'CONNECTOR_AUTH_MISSING', 'X-API-Key header is required', keyInfo);
            return errorResponse(res, 'X-API-Key header is required. Obtain your key from your system administrator.', 401);
        }

        const context = await ConnectorModel.validateKey(apiKey);

        if (!context) {
            const keyInfo = parseKeyDetails(apiKey);
            await logAuthActivity(req, 'Failed', 'CONNECTOR_AUTH_INVALID_KEY', 'Invalid or inactive API key', keyInfo);
            return errorResponse(res, 'Invalid or inactive API key', 401);
        }

        // Attach resolved workspace context for use in downstream controllers
        req.connectorContext = context;

        // Log authentication success
        const keyInfo = parseKeyDetails(apiKey);
        await logAuthActivity(req, 'Success', 'CONNECTOR_AUTH_SUCCESS', null, keyInfo);

        next();
    } catch (error) {
        console.error('[apiKeyMiddleware]', error);
        const keyInfo = parseKeyDetails(apiKey);
        await logAuthActivity(req, 'Failed', 'CONNECTOR_AUTH_ERROR', error.message, keyInfo);
        return errorResponse(res, 'API key validation failed', 500);
    }
};

module.exports = { validateApiKeyMiddleware };
