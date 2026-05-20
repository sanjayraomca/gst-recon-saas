const axios = require('axios');
const whiteBookConfig = require('../../config/whitebook');

/**
 * Shared White Book HTTP Client
 * All calls to White Book go through this module
 * Attaches the common credentials (client_id, client_secret, email) automatically
 */

const wbAxios = axios.create({
    baseURL: whiteBookConfig.baseUrl,
    timeout: 30000,
});

/**
 * Build common headers required by all White Book API calls
 */
const getCommonHeaders = (extra = {}) => ({
    'client_id': whiteBookConfig.clientId,
    'client_secret': whiteBookConfig.clientSecret,
    ...extra
});

/**
 * GET /public/search - Search Taxpayer by GSTIN (no auth token needed)
 * @param {string} gstin
 */
const searchTaxpayer = async (gstin) => {
    const response = await wbAxios.get('/public/search', {
        params: {
            email: whiteBookConfig.email,
            gstin
        },
        headers: getCommonHeaders()
    });
    return response.data;
};

/**
 * GET /public/rettrack - View and Track Returns
 * @param {string} gstin
 * @param {string} fy - Financial Year YYYY-YY
 * @param {string} type - Return type (R1, 3B etc), optional
 */
const trackReturns = async (gstin, fy, type = null) => {
    const params = { email: whiteBookConfig.email, gstin, fy };
    if (type) params.type = type;

    const response = await wbAxios.get('/public/rettrack', {
        params,
        headers: getCommonHeaders()
    });
    return response.data;
};

/**
 * GET /public/pref - Get Preferences
 * @param {string} gstin
 * @param {string} fy - Financial Year YYYY-YY
 * @param {string} stateCd - State Code
 * @param {string} ipAddress - Caller IP
 */
const getPreferences = async (gstin, fy, stateCd, ipAddress) => {
    const response = await wbAxios.get('/public/pref', {
        params: {
            email: whiteBookConfig.email,
            gstin,
            fy
        },
        headers: getCommonHeaders({
            'state_cd': stateCd,
            'ip_address': ipAddress
        })
    });
    return response.data;
};

/**
 * GET /authentication/otprequest - Request OTP for a GST username
 * @param {string} gstUsername - Taxpayer GST portal username
 * @param {string} stateCd
 * @param {string} ipAddress
 */
const requestOtp = async (gstUsername, stateCd, ipAddress) => {
    const response = await wbAxios.get('/authentication/otprequest', {
        params: { email: whiteBookConfig.email },
        headers: getCommonHeaders({
            'gst_username': gstUsername,
            'state_cd': stateCd,
            'ip_address': ipAddress
        })
    });
    return response.data;
};

/**
 * GET /authentication/authtoken - Get auth token after OTP verification
 * @param {string} gstUsername
 * @param {string} otp
 * @param {string} txn - Transaction ID from OTP request
 * @param {string} stateCd
 * @param {string} ipAddress
 */
const getAuthToken = async (gstUsername, otp, txn, stateCd, ipAddress) => {
    const response = await wbAxios.get('/authentication/authtoken', {
        params: {
            email: whiteBookConfig.email,
            otp
        },
        headers: getCommonHeaders({
            'gst_username': gstUsername,
            'txn': txn,
            'state_cd': stateCd,
            'ip_address': ipAddress
        })
    });
    return response.data;
};

module.exports = {
    searchTaxpayer,
    trackReturns,
    getPreferences,
    requestOtp,
    getAuthToken
};
