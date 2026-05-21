const db = require('../config/db');

/**
 * API Key Authentication Middleware Factory
 * @param {string} requiredLib - The library namespace required for this router (e.g. 'GST')
 */
const apiKeyAuth = (requiredLib) => async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'Missing API key. Include X-API-Key header.'
        });
    }

    try {
        const client = await db('ext_api_clients')
            .where({ api_key: apiKey, is_active: true })
            .first();

        if (!client) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or inactive API key.'
            });
        }

        // Verify library permission
        if (requiredLib && (!client.allowed_libs || !client.allowed_libs.includes(requiredLib))) {
            return res.status(403).json({
                success: false,
                error: `Access denied. Your API key does not have permission to access the '${requiredLib}' library.`
            });
        }

        // Attach client info to request for downstream use
        req.apiClient = client;
        next();
    } catch (error) {
        console.error('[apiKeyAuth] Error:', error.message);
        return res.status(500).json({ success: false, error: 'Authentication error.' });
    }
};

module.exports = apiKeyAuth;
