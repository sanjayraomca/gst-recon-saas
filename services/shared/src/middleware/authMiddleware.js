const jwt = require('jsonwebtoken');
const knex = require('../db/connection');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    console.log(`verifyToken: Token present=${!!token}`);

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        let decoded;
        if (process.env.KEYCLOAK_PUBLIC_KEY && process.env.KEYCLOAK_PUBLIC_KEY.trim() !== '') {
            const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.KEYCLOAK_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;
            decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        } else {
            decoded = jwt.decode(token);
            if (!decoded) {
                throw new Error("Invalid token structure");
            }
            // Manual Expiry Check
            if (Date.now() >= decoded.exp * 1000) {
                console.error(`Token expired: Now=${Date.now()}, Exp=${decoded.exp * 1000}`);
                throw new Error("Token expired");
            }
        }

        const sub = decoded.sub || decoded.sid || decoded.id;
        req.user = {
            ...decoded,
            sub: sub,
            id: sub,
            email: (decoded.email || decoded.preferred_username || '').toLowerCase()
        };

        // Resolve internal DB user ID (UUID) and Tenant ID
        try {
            let dbUser = await knex('users').where({ auth_provider_id: sub }).select('id', 'tenant_id').first();
            
            if (!dbUser && req.user.email) {
                // Fallback to email lookup if sub not found (e.g. first login after migration or sync issue)
                dbUser = await knex('users').where({ email: req.user.email }).select('id', 'tenant_id', 'auth_provider_id').first();
                
                if (dbUser && !dbUser.auth_provider_id) {
                    // "Repair" the record by linking the sub to this email-matched user
                    await knex('users').where({ id: dbUser.id }).update({ auth_provider_id: sub });
                    console.log(`[authMiddleware] Linked sub ${sub} to existing user ${req.user.email}`);
                }
            }

            if (dbUser) {
                req.user.db_id = dbUser.id; // Correct internal UUID
                req.user.tenantId = dbUser.tenant_id; // For activity logging fallback
                req.user.tenant_id = dbUser.tenant_id; // Normalize key
            } else {
                console.warn(`[authMiddleware] User not found in database for sub: ${sub}, email: ${req.user.email}`);
            }
        } catch (dbErr) {
            console.error('[authMiddleware] DB lookup failed:', dbErr.message);
        }

        console.log(`verifyToken: Success, sub=${req.user.sub}, email=${req.user.email}, db_id=${req.user.db_id}`);
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
