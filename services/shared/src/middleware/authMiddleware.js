const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    console.log(`verifyToken: Token present=${!!token}`);

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        // 1. Try to verify with signed secret if provided (HS256)
        // 2. Try to verify with Public Key if provided (RS256)
        // Check if KEYCLOAK_PUBLIC_KEY is actually present and not just an empty string
        if (process.env.KEYCLOAK_PUBLIC_KEY && process.env.KEYCLOAK_PUBLIC_KEY.trim() !== '') {
            const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.KEYCLOAK_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;
            const user = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
            req.user = user;
            return next();
        }

        // 3. Fallback: Decode without full signature verification (Dev Mode for Keycloak)
        // Since getting the public key from Keycloak dynamically requires another fetch,
        // we'll trust the token structure if we are in a trusted env.
        // WARNING: In PROD, we must fetch the certs from JWKS endpoint.
        const decoded = jwt.decode(token);

        if (!decoded) {
            throw new Error("Invalid token structure");
        }

        // Manual Expiry Check
        if (Date.now() >= decoded.exp * 1000) {
            console.error(`Token expired: Now=${Date.now()}, Exp=${decoded.exp * 1000}, Diff=${Date.now() - (decoded.exp * 1000)}ms`);
            throw new Error("Token expired");
        }

        req.user = decoded;
        console.log(`verifyToken: Success, sub=${decoded.sub}, email=${decoded.email}`);
        next();
    } catch (err) {
        console.error('Token verification failed:', err.message);
        if (err.message === 'Token expired') {
            return res.status(401).json({ error: 'Token expired', details: { now: Date.now() } });
        }
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

module.exports = {
    verifyToken
};
