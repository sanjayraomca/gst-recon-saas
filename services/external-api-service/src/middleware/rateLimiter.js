const rateLimitMap = new Map();

// Periodic cleanup to prevent memory leaks from inactive clients
setInterval(() => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    for (const [clientId, timestamps] of rateLimitMap.entries()) {
        const active = timestamps.filter(t => t > oneMinuteAgo);
        if (active.length === 0) {
            rateLimitMap.delete(clientId);
        } else {
            rateLimitMap.set(clientId, active);
        }
    }
}, 60000);

/**
 * Enterprise Rate Limiter Middleware
 * Tracks client requests in a 60-second rolling window.
 * Inject standard X-RateLimit headers.
 */
const rateLimiter = (req, res, next) => {
    if (!req.apiClient) {
        return next();
    }

    const clientId = req.apiClient.id;
    const limit = req.apiClient.rate_limit_per_minute || 60;
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let timestamps = rateLimitMap.get(clientId) || [];
    // Keep only timestamps within the last 60 seconds
    timestamps = timestamps.filter(time => time > oneMinuteAgo);

    // Add current request timestamp to track
    timestamps.push(now);
    rateLimitMap.set(clientId, timestamps);

    const remaining = Math.max(0, limit - timestamps.length);
    const resetTime = timestamps[0] ? Math.ceil((timestamps[0] + 60000 - now) / 1000) : 60;

    // Set standard Rate Limit Headers
    res.set('X-RateLimit-Limit', limit);
    res.set('X-RateLimit-Remaining', remaining);
    res.set('X-RateLimit-Reset', resetTime);

    if (timestamps.length > limit) {
        return res.status(429).json({
            success: false,
            error: `Too many requests. Rate limit of ${limit} requests per minute exceeded.`
        });
    }

    next();
};

module.exports = rateLimiter;
