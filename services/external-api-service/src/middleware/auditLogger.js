const db = require('../config/db');

/**
 * Audit Logger Middleware
 * Logs every API request to ext_api_request_log after response is sent
 */
const auditLogger = (library) => async (req, res, next) => {
    const startTime = Date.now();

    // Hook into response finish event
    res.on('finish', async () => {
        try {
            await db('ext_api_request_log').insert({
                client_id: req.apiClient?.id || null,
                api_key_used: req.headers['x-api-key'] || null,
                library,
                endpoint: req.originalUrl,
                gstin: req.query?.gstin || req.body?.gstin || null,
                return_period: req.query?.retperiod || req.query?.ret_period || req.query?.rtnprd || null,
                http_status: res.statusCode,
                is_cache_hit: req.cacheHit || false,
                response_ms: Date.now() - startTime,
                error_message: res.statusCode >= 400 ? res.locals.errorMessage || null : null,
            });
        } catch (err) {
            // Audit log failure must never crash the service
            console.error('[auditLogger] Failed to log request:', err.message);
        }
    });

    next();
};

module.exports = auditLogger;
