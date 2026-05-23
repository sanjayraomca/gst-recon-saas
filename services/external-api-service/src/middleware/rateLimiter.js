const rateLimitMap = new Map();
const ipRateLimitMap = new Map();

// Periodic cleanup to prevent memory leaks from inactive clients
setInterval(() => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    const cleanupMap = (map) => {
        for (const [key, timestamps] of map.entries()) {
            const active = timestamps.filter(t => t > oneMinuteAgo);
            if (active.length === 0) {
                map.delete(key);
            } else {
                map.set(key, active);
            }
        }
    };
    
    cleanupMap(rateLimitMap);
    cleanupMap(ipRateLimitMap);
}, 60000);

/**
 * Global IP Rate Limiter
 * Applied before all routes to prevent DDoS and brute-force guessing
 */
const globalIpLimiter = (req, res, next) => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const limit = 60; // 60 requests per minute per IP globally

    let timestamps = ipRateLimitMap.get(ip) || [];
    timestamps = timestamps.filter(time => time > oneMinuteAgo);
    timestamps.push(now);
    ipRateLimitMap.set(ip, timestamps);

    if (timestamps.length > limit) {
        return res.status(429).json({
            success: false,
            error: `Too many requests from this IP. Limit of ${limit}/min exceeded.`
        });
    }
    return next();
};

/**
 * Client Rate Limiter
 * Applied after authentication to track actual client usage
 */
const clientLimiter = (req, res, next) => {
    if (!req.apiClient) {
        return next();
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const clientId = req.apiClient.id;
    const limit = req.apiClient.rate_limit_per_minute || 30; // 30 req/min default for clients

    let timestamps = rateLimitMap.get(clientId) || [];
    timestamps = timestamps.filter(time => time > oneMinuteAgo);
    timestamps.push(now);
    rateLimitMap.set(clientId, timestamps);

    const remaining = Math.max(0, limit - timestamps.length);
    const resetTime = timestamps[0] ? Math.ceil((timestamps[0] + 60000 - now) / 1000) : 60;

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

module.exports = {
    globalIpLimiter,
    clientLimiter
};
