/**
 * Whitebook API Configuration
 * Your ONE White Book account credentials live in .env only
 * Never stored in the database
 */
const whiteBookConfig = {
    baseUrl: process.env.WHITEBOOK_BASE_URL || 'https://apisandbox.whitebooks.in',
    clientId: process.env.WHITEBOOK_CLIENT_ID,
    clientSecret: process.env.WHITEBOOK_CLIENT_SECRET,
    email: process.env.WHITEBOOK_EMAIL,
};

if (!whiteBookConfig.clientId || !whiteBookConfig.clientSecret || !whiteBookConfig.email) {
    console.error('[Config] FATAL: WHITEBOOK_CLIENT_ID, WHITEBOOK_CLIENT_SECRET, and WHITEBOOK_EMAIL must be set in environment.');
    process.exit(1);
}

module.exports = whiteBookConfig;
