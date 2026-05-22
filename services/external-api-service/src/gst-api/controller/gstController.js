const wb = require('../services/whiteBookClient');
const model = require('../model/gstModel');
const db = require('../../config/db');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────
// POST /ext/gst/clients - Register a new API client & get API key
// ─────────────────────────────────────────────────────────────
const registerClient = async (req, res) => {
    try {
        const { contact_email, platform, client_name, user_id, extra_info } = req.body;
        if (!contact_email || !platform) {
            return res.status(400).json({ success: false, error: 'contact_email and platform are required.' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contact_email)) {
            return res.status(400).json({ success: false, error: 'Invalid contact_email format.' });
        }

        // Validate user_id if provided
        if (user_id) {
            const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
            if (!uuidRegex.test(user_id)) {
                return res.status(400).json({ success: false, error: 'Invalid user_id format. Must be a valid UUID.' });
            }
            // Verify user exists
            const user = await db('users').where({ id: user_id }).first();
            if (!user) {
                return res.status(404).json({ success: false, error: `User with ID ${user_id} not found.` });
            }
        }

        // Validate extra_info if provided
        if (extra_info !== undefined && extra_info !== null) {
            if (typeof extra_info !== 'object' || Array.isArray(extra_info)) {
                return res.status(400).json({ success: false, error: 'extra_info must be a valid JSON object.' });
            }
        }

        // 1. Check if API key already exists for this email + platform
        const existing = await db('ext_api_clients')
            .where({ contact_email, platform })
            .first();
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `An API key has already been created for contact email '${contact_email}' on platform '${platform}'.`
            });
        }

        const resolvedClientName = client_name || contact_email.split('@')[0];
        const apiKey = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, ''); // 64-char key

        const [client] = await db('ext_api_clients')
            .insert({
                platform,
                client_name: resolvedClientName,
                contact_email,
                api_key: apiKey,
                user_id: user_id || null,
                extra_info: extra_info || null,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            })
            .returning(['id', 'platform', 'client_name', 'contact_email', 'api_key', 'user_id', 'extra_info', 'created_at']);

        return res.status(201).json({
            success: true,
            message: 'API client registered. Store your api_key safely — it will not be shown again.',
            data: client
        });
    } catch (error) {
        console.error('[registerClient]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// POST /ext/gst/clients/gstins - Register a GSTIN for the API client
// ─────────────────────────────────────────────────────────────
const registerClientGstin = async (req, res) => {
    try {
        const { gstin, gst_username, state_code, legal_name } = req.body;
        const clientId = req.apiClient.id;

        if (!gstin || !gst_username || !state_code) {
            return res.status(400).json({ success: false, error: 'gstin, gst_username, and state_code are required.' });
        }

        const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
        if (!gstinRegex.test(gstin)) {
            return res.status(400).json({ success: false, error: 'Invalid GSTIN format.' });
        }

        const existing = await model.getClientGstin(clientId, gstin);
        if (existing) {
            return res.status(409).json({ success: false, error: 'This GSTIN is already registered for your account.' });
        }

        const [row] = await db('ext_client_gstins')
            .insert({
                client_id: clientId,
                gstin,
                gst_username,
                state_code,
                legal_name: legal_name || null,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            })
            .returning(['id', 'gstin', 'gst_username', 'state_code', 'legal_name', 'created_at']);

        // Ensure this GSTIN details are also present in gstin_master
        await model.ensureGstinInMaster(gstin);

        return res.status(201).json({ success: true, message: 'GSTIN registered.', data: row });
    } catch (error) {
        console.error('[registerClientGstin]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /ext/gst/search?gstin=... - Search Taxpayer (cached)
// ─────────────────────────────────────────────────────────────
const searchTaxpayer = async (req, res) => {
    try {
        const { gstin } = req.query;
        if (!gstin) {
            return res.status(400).json({ success: false, error: 'gstin query parameter is required.' });
        }

        // 1. Check cache first
        const cached = await model.getCached(gstin);
        if (cached) {
            // Always sync to gstin_master on cache hit to prevent database state drift
            try {
                const responseData = typeof cached.raw_response === 'string' ? JSON.parse(cached.raw_response) : cached.raw_response;
                await model.syncGstinMaster(gstin, responseData);
            } catch (syncErr) {
                console.error('[searchTaxpayer] Failed to sync on cache hit:', syncErr.message);
            }

            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, source: 'cache', data: cached.raw_response });
        }

        // 2. Call White Book
        const wbData = await wb.searchTaxpayer(gstin);

        // 3. Save to cache
        await model.upsertCache(gstin, wbData);

        res.set('X-Cache', 'MISS');
        return res.json({ success: true, source: 'live', data: wbData });
    } catch (error) {
        console.error('[searchTaxpayer]', error.message);
        res.locals.errorMessage = error.message;
        if (error.response?.status === 404) {
            return res.status(404).json({ success: false, error: 'Taxpayer not found.' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /ext/gst/rettrack?gstin=...&fy=...&type=... - Track Returns
// ─────────────────────────────────────────────────────────────
const trackReturns = async (req, res) => {
    try {
        const { gstin, fy, type } = req.query;
        const clientId = req.apiClient.id;

        if (!gstin || !fy) {
            return res.status(400).json({ success: false, error: 'gstin and fy are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await model.ensureGstinInMaster(gstin);

        // 1. Check cache
        const cached = await model.getCachedReturnTrack(clientId, gstin, fy, type || null);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, source: 'cache', data: cached.returns_data });
        }

        // 2. Call White Book
        const wbData = await wb.trackReturns(gstin, fy, type);

        // 3. Save to DB per client
        await model.upsertReturnTrack(clientId, gstin, fy, type || null, wbData);

        res.set('X-Cache', 'MISS');
        return res.json({ success: true, source: 'live', data: wbData });
    } catch (error) {
        console.error('[trackReturns]', error.message);
        res.locals.errorMessage = error.message;
        if (error.response?.status === 404) {
            return res.status(404).json({ success: false, error: 'No return data found.' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

// GET /ext/gst/preferences?gstin=...&fy=... - Get Preferences
// ─────────────────────────────────────────────────────────────
const getPreferences = async (req, res) => {
    try {
        const { gstin, fy } = req.query;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!gstin || !fy) {
            return res.status(400).json({ success: false, error: 'gstin and fy are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await model.ensureGstinInMaster(gstin);

        // 1. Check cache first
        const cached = await model.getCachedPreferences(gstin, fy);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, source: 'cache', data: cached.preferences_data });
        }

        // Get state code from GSTIN prefix (first 2 digits)
        const stateCd = gstin.substring(0, 2);

        // 2. Call White Book
        const wbData = await wb.getPreferences(gstin, fy, stateCd, ipAddress);

        // 3. Save to cache
        await model.upsertPreferences(gstin, fy, wbData);

        res.set('X-Cache', 'MISS');
        return res.json({ success: true, source: 'live', data: wbData });
    } catch (error) {
        console.error('[getPreferences]', error.message);
        res.locals.errorMessage = error.message;
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// POST /ext/gst/auth/otp-request - Request OTP for a GSTIN
// Body: { gstin, gst_username }
// ─────────────────────────────────────────────────────────────
const requestOtp = async (req, res) => {
    try {
        const { gstin, gst_username } = req.body;
        const clientId = req.apiClient.id;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!gstin || !gst_username) {
            return res.status(400).json({ success: false, error: 'gstin and gst_username are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await model.ensureGstinInMaster(gstin);

        // Verify GSTIN is registered for this client
        const clientGstin = await model.getClientGstin(clientId, gstin);
        if (!clientGstin) {
            return res.status(403).json({ success: false, error: 'This GSTIN is not registered for your API key. Register it first via POST /ext/gst/clients/gstins' });
        }

        const stateCd = gstin.substring(0, 2);
        const wbData = await wb.requestOtp(gst_username, stateCd, ipAddress);

        // Save OTP txn reference
        await model.saveOtpTxn(gstin, gst_username, wbData.txn || null);

        return res.json({
            success: true,
            message: 'OTP sent to registered mobile and email of the GST username.',
            txn: wbData.txn || null
        });
    } catch (error) {
        console.error('[requestOtp]', error.message);
        res.locals.errorMessage = error.message;
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// POST /ext/gst/auth/verify-otp - Verify OTP and get auth token
// Body: { gstin, gst_username, otp, txn }
// ─────────────────────────────────────────────────────────────
const verifyOtp = async (req, res) => {
    try {
        const { gstin, gst_username, otp, txn } = req.body;
        const clientId = req.apiClient.id;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        if (!gstin || !gst_username || !otp || !txn) {
            return res.status(400).json({ success: false, error: 'gstin, gst_username, otp, and txn are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await model.ensureGstinInMaster(gstin);

        const clientGstin = await model.getClientGstin(clientId, gstin);
        if (!clientGstin) {
            return res.status(403).json({ success: false, error: 'GSTIN not registered for this API key.' });
        }

        const stateCd = gstin.substring(0, 2);
        const wbData = await wb.getAuthToken(gst_username, otp, txn, stateCd, ipAddress);

        // Persist the auth session
        await model.upsertAuthSession(clientGstin.id, gstin, gst_username, wbData);

        return res.json({
            success: true,
            message: 'Authentication successful. Session stored and will be reused automatically.',
        });
    } catch (error) {
        console.error('[verifyOtp]', error.message);
        res.locals.errorMessage = error.message;
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, error: 'Invalid OTP or expired transaction.' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    registerClient,
    registerClientGstin,
    searchTaxpayer,
    trackReturns,
    getPreferences,
    requestOtp,
    verifyOtp
};
