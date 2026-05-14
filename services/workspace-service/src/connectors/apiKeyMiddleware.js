const ConnectorModel = require('./connectorModel');
const { errorResponse } = require('../../../shared/src/utils/responseHandler');

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
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return errorResponse(res, 'X-API-Key header is required. Obtain your key from your system administrator.', 401);
        }

        const context = await ConnectorModel.validateKey(apiKey);

        if (!context) {
            return errorResponse(res, 'Invalid or inactive API key', 401);
        }

        // Attach resolved workspace context for use in downstream controllers
        req.connectorContext = context;
        next();
    } catch (error) {
        console.error('[apiKeyMiddleware]', error);
        return errorResponse(res, 'API key validation failed', 500);
    }
};

module.exports = { validateApiKeyMiddleware };
