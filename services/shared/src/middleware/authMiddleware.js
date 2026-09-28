const jwt = require('jsonwebtoken');
const knex = require('../db/connection');

const toPem = (raw) => {
    if (!raw) return null;
    if (raw.includes('BEGIN PUBLIC KEY')) return raw.replace(/\\n/g, '\n');
    return `-----BEGIN PUBLIC KEY-----\n${raw}\n-----END PUBLIC KEY-----`;
};

/**
 * PEM public key used to verify Keycloak-issued RS256 tokens.
 *
 * 1. KEYCLOAK_PUBLIC_KEY (bare base64 "public_key" from GET <KEYCLOAK_URL>/realms/<realm>, or a PEM), if set.
 * 2. Otherwise it is fetched from Keycloak itself over the internal Docker network
 *    (KEYCLOAK_URL, default http://keycloak:8080; KEYCLOAK_REALM, default gsttool) and cached,
 *    so the stack works without anyone pasting the key into .env.
 * Returns null when neither is available -> requests are rejected (fail closed).
 */
const KEY_CACHE_MS = 60 * 60 * 1000;   // re-read the realm key hourly (picks up key rotation)
const RETRY_MS = 15 * 1000;            // after a failed fetch, wait before trying again
let fetchedKey = null;
let fetchedAt = 0;
let lastFailureAt = 0;
let inflight = null;

const fetchRealmPublicKey = async () => {
    const base = (process.env.KEYCLOAK_URL || 'http://keycloak:8080').replace(/\/+$/, '');
    const realm = process.env.KEYCLOAK_REALM || 'gsttool';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const resp = await fetch(`${base}/realms/${encodeURIComponent(realm)}`, { signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        if (!body || !body.public_key) throw new Error('no public_key in realm response');
        return toPem(body.public_key);
    } finally {
        clearTimeout(timer);
    }
};

const getKeycloakPublicKey = async () => {
    const configured = toPem((process.env.KEYCLOAK_PUBLIC_KEY || '').trim());
    if (configured) return configured;

    const now = Date.now();
    if (fetchedKey && now - fetchedAt < KEY_CACHE_MS) return fetchedKey;
    if (!fetchedKey && now - lastFailureAt < RETRY_MS) return null;

    if (!inflight) {
        inflight = fetchRealmPublicKey()
            .then((pem) => {
                fetchedKey = pem;
                fetchedAt = Date.now();
                console.log('[authMiddleware] Loaded Keycloak realm public key from Keycloak.');
                return pem;
            })
            .catch((err) => {
                lastFailureAt = Date.now();
                console.error(`[authMiddleware] Could not load the Keycloak public key (${err.message}). Set KEYCLOAK_PUBLIC_KEY or check that Keycloak is reachable.`);
                return fetchedKey; // keep using a previously loaded key if we had one
            })
            .finally(() => { inflight = null; });
    }
    return inflight;
};

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    // Fail closed: without a verification key we cannot tell a real token from a forged one.
    const publicKey = await getKeycloakPublicKey();
    if (!publicKey) {
        console.error('[authMiddleware] Rejecting request: no Keycloak public key (KEYCLOAK_PUBLIC_KEY unset and Keycloak unreachable)');
        return res.status(503).json({ error: 'Authentication is not configured on this server' });
    }

    try {
        let decoded;
        try {
            decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        } catch (verifyErr) {
            if (verifyErr.name === 'TokenExpiredError') {
                // 401 (not 403) so the frontend's refresh-token interceptor kicks in
                throw new Error('Token expired');
            }
            throw verifyErr;
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
