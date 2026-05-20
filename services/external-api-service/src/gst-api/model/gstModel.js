const db = require('../../config/db');

const CACHE_TTL_HOURS = 24; // Taxpayer details cached for 24 hours

/**
 * Get cached taxpayer by GSTIN
 */
const getCached = async (gstin) => {
    const row = await db('ext_taxpayer_cache')
        .where({ gstin })
        .where('cached_until', '>', new Date())
        .first();
    return row || null;
};

/**
 * Upsert taxpayer cache
 */
const upsertCache = async (gstin, data) => {
    const cachedUntil = new Date();
    cachedUntil.setHours(cachedUntil.getHours() + CACHE_TTL_HOURS);

    const row = {
        gstin,
        legal_name: data.lgnm || data.legal_name || null,
        trade_name: data.tradeNam || data.trade_name || null,
        taxpayer_status: data.sts || null,
        registration_type: data.dty || null,
        registration_date: data.rgdt || null,
        cancellation_date: data.cxdt || null,
        state_code: data.stj ? data.stj.substring(0, 2) : (gstin.substring(0, 2)),
        center_jurisdiction: data.ctj || null,
        state_jurisdiction: data.stj || null,
        business_nature: data.nba ? JSON.stringify(data.nba) : null,
        principal_address: data.pradr ? JSON.stringify(data.pradr) : null,
        raw_response: JSON.stringify(data),
        cached_until: cachedUntil,
        updated_at: new Date()
    };

    await db('ext_taxpayer_cache')
        .insert({ ...row, created_at: new Date() })
        .onConflict('gstin')
        .merge({
            ...row
        });

    return await db('ext_taxpayer_cache').where({ gstin }).first();
};

/**
 * Get cached return track
 */
const getCachedReturnTrack = async (clientId, gstin, financialYear, returnType) => {
    return await db('ext_return_track')
        .where({ client_id: clientId, gstin, financial_year: financialYear, return_type: returnType || null })
        .where('cached_until', '>', new Date())
        .first();
};

/**
 * Upsert return track cache
 */
const upsertReturnTrack = async (clientId, gstin, financialYear, returnType, data) => {
    const cachedUntil = new Date();
    cachedUntil.setHours(cachedUntil.getHours() + 6); // Cache returns for 6 hours

    const row = {
        client_id: clientId,
        gstin,
        financial_year: financialYear,
        return_type: returnType || null,
        returns_data: JSON.stringify(data),
        cached_until: cachedUntil,
        updated_at: new Date()
    };

    await db('ext_return_track')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['client_id', 'gstin', 'financial_year', 'return_type'])
        .merge({ ...row });
};

/**
 * Get active auth session for a GSTIN
 */
const getAuthSession = async (gstin, gstUsername) => {
    return await db('ext_gstn_auth_sessions')
        .where({ gstin, gst_username: gstUsername, is_active: true })
        .where('token_expiry', '>', new Date())
        .first();
};

/**
 * Upsert auth session
 */
const upsertAuthSession = async (clientGstinId, gstin, gstUsername, data) => {
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 6); // GSP tokens valid ~6 hours

    const row = {
        client_gstin_id: clientGstinId,
        gstin,
        gst_username: gstUsername,
        auth_token: data.auth_token || data.authToken || null,
        otp_txn: data.txn || null,
        otp_requested_at: data.otp_requested_at || null,
        token_expiry: tokenExpiry,
        is_active: true,
        updated_at: new Date()
    };

    await db('ext_gstn_auth_sessions')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['gstin', 'gst_username'])
        .merge({ ...row });
};

/**
 * Save OTP txn against a GSTIN session
 */
const saveOtpTxn = async (gstin, gstUsername, txn) => {
    const existing = await db('ext_gstn_auth_sessions')
        .where({ gstin, gst_username: gstUsername })
        .first();

    if (existing) {
        await db('ext_gstn_auth_sessions')
            .where({ gstin, gst_username: gstUsername })
            .update({ otp_txn: txn, otp_requested_at: new Date(), updated_at: new Date() });
    }
};

/**
 * Get client's registered GSTIN record
 */
const getClientGstin = async (clientId, gstin) => {
    return await db('ext_client_gstins')
        .where({ client_id: clientId, gstin, is_active: true })
        .first();
};

module.exports = {
    getCached,
    upsertCache,
    getCachedReturnTrack,
    upsertReturnTrack,
    getAuthSession,
    upsertAuthSession,
    saveOtpTxn,
    getClientGstin
};
