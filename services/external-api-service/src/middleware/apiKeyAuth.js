const db = require('../config/db');

/**
 * API Key Authentication Middleware Factory
 * @param {string} requiredLib - The library namespace required for this router (e.g. 'GST', 'EWAYBILL', 'EINVOICE')
 */
const apiKeyAuth = (requiredLib) => async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'Missing API key. Include X-API-Key header.'
        });
    }

    // Pre-Validation: 32-character hex alphanumeric check to prevent DB connection exhaustion
    const apiKeyRegex = /^[a-fA-F0-9]{32}$/;
    if (!apiKeyRegex.test(apiKey)) {
        return res.status(401).json({
            success: false,
            error: 'Invalid API key format.'
        });
    }

    try {
        const access = await db('api_conn_allowed_access')
            .where({ api_key: apiKey })
            .first();

        if (!access) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or inactive API key.'
            });
        }

        // Verify library permission and remaining limits
        if (requiredLib) {
            let serviceFlag = false;
            let remainingCalls = 0;

            if (requiredLib === 'GST') {
                serviceFlag = access.service_gst;
                remainingCalls = access.remaining_gst_api_call;
            } else if (requiredLib === 'EWAYBILL') {
                serviceFlag = access.service_eway_bill;
                remainingCalls = access.remaining_eway_bill_api_call;
            } else if (requiredLib === 'EINVOICE') {
                serviceFlag = access.service_einvoice;
                remainingCalls = access.remaining_einvoice_api_call;
            }

            if (!serviceFlag) {
                return res.status(403).json({
                    success: false,
                    error: `Access denied. Your API key does not have permission to access the '${requiredLib}' library.`
                });
            }

            if (remainingCalls <= 0) {
                return res.status(429).json({
                    success: false,
                    error: `Quota exceeded. You have 0 remaining API calls for the '${requiredLib}' library.`
                });
            }
        }

        // Attach client info to request for downstream use
        const client = await db('api_conn_access_key')
            .where('production_key', apiKey)
            .orWhere('sandbox_key', apiKey)
            .orWhere('app_secret_key', apiKey)
            .first();

        req.apiClient = client || { platform: 'Unknown', id: access.id };
        req.allowedAccess = access;
        next();
    } catch (error) {
        console.error('[apiKeyAuth] Error:', error.message);
        return res.status(500).json({ success: false, error: 'Authentication error.' });
    }
};

module.exports = apiKeyAuth;
