/**
 * Platform-level super admin designation.
 *
 * A user is a platform super admin only when the server-side record says so:
 *   users.metadata.platform_role === 'SUPER_ADMIN'
 *
 * No API endpoint writes users.metadata, so this cannot be self-granted.
 * Grant it with seed-superadmin.js or a direct, audited DB update:
 *   UPDATE users
 *      SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"platform_role":"SUPER_ADMIN"}'::jsonb
 *    WHERE email = '<admin email>';
 */
const PLATFORM_SUPER_ADMIN = 'SUPER_ADMIN';

const parseMetadata = (metadata) => {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch (e) {
            return {};
        }
    }
    return metadata;
};

/**
 * @param {object|null|undefined} userRow - a row from the users table (must include metadata)
 * @returns {boolean}
 */
const isPlatformSuperAdmin = (userRow) => {
    if (!userRow || userRow.is_active === false) return false;
    return parseMetadata(userRow.metadata).platform_role === PLATFORM_SUPER_ADMIN;
};

/**
 * SQL predicate (for knex whereRaw) that excludes platform super admins.
 * Pass the table alias that holds the users row, e.g. 'users'.
 */
const notPlatformSuperAdminSql = (usersAlias = 'users') =>
    `COALESCE(${usersAlias}.metadata->>'platform_role', '') <> '${PLATFORM_SUPER_ADMIN}'`;

module.exports = {
    PLATFORM_SUPER_ADMIN,
    isPlatformSuperAdmin,
    notPlatformSuperAdminSql,
    parseMetadata
};
