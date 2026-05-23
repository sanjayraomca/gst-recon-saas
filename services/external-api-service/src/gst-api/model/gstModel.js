const db = require('../../config/db');

const CACHE_TTL_HOURS = 168; // Taxpayer details cached for 7 days (168 hours)

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
 * Sync taxpayer details directly to gstin_master
 */
const syncGstinMaster = async (gstin, data) => {
    try {
        const taxpayer = data.data || data || {};
        const rawRegType = (taxpayer.dty || 'REGULAR').toUpperCase();
        const allowedRegTypes = ['REGULAR', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'ISD', 'CASUAL'];
        const regType = allowedRegTypes.includes(rawRegType) ? rawRegType : 'REGULAR';

        const parseGspDate = (dateStr) => {
            if (!dateStr) return null;
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            return dateStr;
        };

        const gstinMasterRow = {
            gstin,
            legal_name: taxpayer.lgnm || taxpayer.legal_name || 'Unknown Taxpayer',
            trade_name: taxpayer.tradeNam || taxpayer.trade_name || null,
            registration_type: regType,
            registration_date: parseGspDate(taxpayer.rgdt || null),
            cancellation_date: parseGspDate(taxpayer.cxdt || null),
            state_code: taxpayer.stj ? taxpayer.stj.substring(0, 2) : gstin.substring(0, 2),
            center_jurisdiction: taxpayer.ctj || null,
            state_jurisdiction: taxpayer.stj || null,
            business_nature: taxpayer.nba ? (typeof taxpayer.nba === 'string' ? taxpayer.nba : JSON.stringify(taxpayer.nba)) : null,
            address: taxpayer.pradr ? (typeof taxpayer.pradr === 'string' ? JSON.parse(taxpayer.pradr) : taxpayer.pradr) : null,
            gstin_status: (taxpayer.sts || 'ACTIVE').toUpperCase(),
            is_active: (taxpayer.sts || '').toUpperCase() === 'ACTIVE',
            updated_at: new Date()
        };

        await db('gstin_master')
            .insert({ ...gstinMasterRow, created_at: new Date() })
            .onConflict('gstin')
            .merge({ ...gstinMasterRow });
    } catch (masterError) {
        console.error('[syncGstinMaster] Failed to sync to gstin_master:', masterError.message);
    }
};

/**
 * Upsert taxpayer cache
 */
const upsertCache = async (gstin, data) => {
    const cachedUntil = new Date();
    cachedUntil.setHours(cachedUntil.getHours() + CACHE_TTL_HOURS);

    const taxpayer = data.data || data || {};

    const row = {
        gstin,
        legal_name: taxpayer.lgnm || taxpayer.legal_name || null,
        trade_name: taxpayer.tradeNam || taxpayer.trade_name || null,
        taxpayer_status: taxpayer.sts || null,
        registration_type: taxpayer.dty || null,
        registration_date: taxpayer.rgdt || null,
        cancellation_date: taxpayer.cxdt || null,
        state_code: taxpayer.stj ? taxpayer.stj.substring(0, 2) : (gstin.substring(0, 2)),
        center_jurisdiction: taxpayer.ctj || null,
        state_jurisdiction: taxpayer.stj || null,
        business_nature: taxpayer.nba ? (typeof taxpayer.nba === 'string' ? taxpayer.nba : JSON.stringify(taxpayer.nba)) : null,
        principal_address: taxpayer.pradr ? (typeof taxpayer.pradr === 'string' ? taxpayer.pradr : JSON.stringify(taxpayer.pradr)) : null,
        raw_response: JSON.stringify(data),
        cached_until: cachedUntil,
        updated_at: new Date()
    };

    // 1. Update ext_taxpayer_cache
    await db('ext_taxpayer_cache')
        .insert({ ...row, created_at: new Date() })
        .onConflict('gstin')
        .merge({ ...row });

    // 2. Sync to gstin_master
    await syncGstinMaster(gstin, data);

    return await db('ext_taxpayer_cache').where({ gstin }).first();
};

/**
 * Get cached return track (shared globally to minimize third-party API triggers)
 */
const getCachedReturnTrack = async (clientId, gstin, financialYear, returnType) => {
    return await db('ext_return_track')
        .where({ gstin, financial_year: financialYear, return_type: returnType || null })
        .where('cached_until', '>', new Date())
        .orderBy('created_at', 'desc')
        .first();
};

/**
 * Upsert return track cache (smart TTL based on Financial Year)
 */
const upsertReturnTrack = async (clientId, gstin, financialYear, returnType, data) => {
    const cachedUntil = new Date();

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12
    let currentFyStartYear = currentMonth <= 3 ? currentYear - 1 : currentYear;

    let requestedFyStartYear = currentFyStartYear;
    if (financialYear && financialYear.includes('-')) {
        requestedFyStartYear = parseInt(financialYear.split('-')[0], 10);
    }

    if (requestedFyStartYear < currentFyStartYear) {
        // Requested FY is in the past. It will never change. Cache for 1 year (8760 hours).
        cachedUntil.setHours(cachedUntil.getHours() + 8760); 
    } else {
        // Current FY might still be updated. Cache for 48 hours.
        cachedUntil.setHours(cachedUntil.getHours() + 48); 
    }

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
const upsertAuthSession = async (gstMasterId, gstin, gstUsername, data) => {
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 6); // GSP tokens valid ~6 hours

    const row = {
        gst_master_id: gstMasterId,
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
const getClientGstin = async (platform, gstin) => {
    return await db('api_conn_gst_master')
        .where({ platform, gstn: gstin, is_active: true })
        .first();
};

/**
 * Get cached filing preferences by GSTIN & FY (shared globally)
 */
const getCachedPreferences = async (gstin, financialYear) => {
    return await db('ext_preferences_cache')
        .where({ gstin, financial_year: financialYear })
        .where('cached_until', '>', new Date())
        .first();
};

/**
 * Upsert preferences cache (valid for 7 days)
 */
const upsertPreferences = async (gstin, financialYear, data) => {
    const cachedUntil = new Date();
    cachedUntil.setHours(cachedUntil.getHours() + 168); // Cache filing preferences for 7 days (168 hours)

    const row = {
        gstin,
        financial_year: financialYear,
        preferences_data: JSON.stringify(data),
        cached_until: cachedUntil,
        updated_at: new Date()
    };

    await db('ext_preferences_cache')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['gstin', 'financial_year'])
        .merge({ ...row });
};

/**
 * Ensure a GSTIN's taxpayer profile exists in gstin_master.
 * If not present in gstin_master:
 *  1. Checks cache (ext_taxpayer_cache).
 *  2. If found in cache, syncs to gstin_master.
 *  3. If not found in cache, does a live lookup from GSP (White Book), caches it, and syncs.
 */
const ensureGstinInMaster = async (gstin) => {
    if (!gstin) return;
    try {
        // 1. Check gstin_master
        const masterMatch = await db('gstin_master').where({ gstin }).first();
        if (masterMatch) {
            return; // Already exists
        }

        console.log(`[ensureGstinInMaster] GSTIN ${gstin} not found in gstin_master. Resolving...`);

        // 2. Check taxpayer cache
        const cached = await getCached(gstin);
        if (cached) {
            const responseData = typeof cached.raw_response === 'string' ? JSON.parse(cached.raw_response) : cached.raw_response;
            await syncGstinMaster(gstin, responseData);
            console.log(`[ensureGstinInMaster] Resolved ${gstin} from cache and synced to gstin_master.`);
            return;
        }

        // 3. Fallback to GSP Live lookup
        console.log(`[ensureGstinInMaster] Cache miss for ${gstin}. Performing live GSP lookup...`);
        const wb = require('../services/whiteBookClient');
        const wbData = await wb.searchTaxpayer(gstin);
        if (wbData) {
            await upsertCache(gstin, wbData);
            console.log(`[ensureGstinInMaster] Live resolved ${gstin}, cached, and synced to gstin_master.`);
        }
    } catch (err) {
        console.error(`[ensureGstinInMaster] Failed to ensure GSTIN ${gstin} in gstin_master:`, err.message);
    }
};

module.exports = {
    getCached,
    upsertCache,
    syncGstinMaster,
    ensureGstinInMaster,
    getCachedReturnTrack,
    upsertReturnTrack,
    getCachedPreferences,
    upsertPreferences,
    getAuthSession,
    upsertAuthSession,
    saveOtpTxn,
    getClientGstin
};
