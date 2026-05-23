const db = require('../config/db');

/**
 * Audit Logger Middleware
 * Logs every API request to api_conn_api_access_log after response is sent
 */
const auditLogger = (library) => async (req, res, next) => {
    const startTime = Date.now();

    // Hook into response finish event
    res.on('finish', async () => {
        try {
            const apiKey = req.headers['x-api-key'] || null;
            const allowedAccessId = req.allowedAccess?.id || null;
            const platform = req.apiClient?.platform || null;
            const responseMs = Date.now() - startTime;

            await db('api_conn_api_access_log').insert({
                api_conn_allowed_access_id: allowedAccessId,
                api_key: apiKey,
                server_ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
                api_name: req.originalUrl,
                api_cat: library,
                request_params: req.method === 'GET' ? JSON.stringify(req.query || {}) : JSON.stringify(req.body || {}),
                resposne_params: JSON.stringify({ status: res.statusCode }),
                status: res.statusCode >= 400 ? 'failed' : 'completed',
                request_header: JSON.stringify(req.headers || {}),
                action_by: req.apiClient?.contact_email || 'system',
                metadata: JSON.stringify({ response_ms: responseMs, is_cache_hit: req.cacheHit || false, error_message: res.locals.errorMessage || null }),
                platform: platform,
                added_at: new Date(),
                updated_at: new Date()
            });

            // Deduct API quota if request successful or not a client-side auth error
            if (res.statusCode < 400 && allowedAccessId && library && !req.cacheHit) {
                let consumeField, remainingField;
                if (library === 'GST') {
                    consumeField = 'consume_gst_api_call';
                    remainingField = 'remaining_gst_api_call';
                } else if (library === 'EWAYBILL') {
                    consumeField = 'consume_eway_bill_api_call';
                    remainingField = 'remaining_eway_bill_api_call';
                } else if (library === 'EINVOICE') {
                    consumeField = 'consume_einvoice_api_call';
                    remainingField = 'remaining_einvoice_api_call';
                }

                if (consumeField && remainingField) {
                    await db('api_conn_allowed_access')
                        .where({ id: allowedAccessId })
                        .increment(consumeField, 1)
                        .decrement(remainingField, 1);
                }
            }

        } catch (err) {
            // Audit log failure must never crash the service
            console.error('[auditLogger] Failed to log request:', err.message);
        }
    });

    next();
};

module.exports = auditLogger;
