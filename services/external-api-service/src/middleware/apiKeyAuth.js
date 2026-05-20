const db = require('../config/db');

/**
 * API Key Authentication Middleware
 * Every request from external apps must include: Header X-API-Key
 * Validates key against ext_api_clients table and attaches client to req
 */
const apiKeyAuth = async (req, res, next) => {
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

        // Attach client info to request for downstream use
        req.apiClient = client;
        next();
    } catch (error) {
        console.error('[apiKeyAuth] Error:', error.message);
        return res.status(500).json({ success: false, error: 'Authentication error.' });
    }
};

module.exports = apiKeyAuth;
