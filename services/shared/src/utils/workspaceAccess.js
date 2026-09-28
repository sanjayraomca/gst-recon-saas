/**
 * Workspace access checks that are always resolved from the database.
 *
 * Never decide "global admin" from token claims (role / groups): Keycloak group
 * names such as "Super Admin" are created per organisation and can be assigned
 * by tenant admins, so a claim like groups: ["Super Admin"] says nothing about
 * platform-wide rights.
 */
const knex = require('../db/connection');
const { isPlatformSuperAdmin } = require('./platformAdmin');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} dbUserId - internal users.id (req.user.db_id), NOT the Keycloak sub
 * @returns {Promise<boolean>}
 */
const isPlatformSuperAdminById = async (dbUserId) => {
    if (!dbUserId || !UUID_RE.test(String(dbUserId))) return false;
    const user = await knex('users').where({ id: dbUserId }).select('id', 'metadata', 'is_active').first();
    return isPlatformSuperAdmin(user);
};

/**
 * Active (accepted, not removed) membership of a user in a workspace, or null.
 */
const getActiveMembership = async (dbUserId, workspaceId) => {
    if (!dbUserId || !workspaceId || !UUID_RE.test(String(dbUserId)) || !UUID_RE.test(String(workspaceId))) return null;
    const membership = await knex('workspace_users')
        .where({ workspace_id: workspaceId, user_id: dbUserId, invitation_status: 'ACTIVE' })
        .whereNull('removed_at')
        .first();
    return membership || null;
};

/**
 * True for platform super admins and for active members of the workspace.
 */
const canAccessWorkspace = async (dbUserId, workspaceId) => {
    if (await isPlatformSuperAdminById(dbUserId)) return true;
    return !!(await getActiveMembership(dbUserId, workspaceId));
};

module.exports = {
    UUID_RE,
    isPlatformSuperAdminById,
    getActiveMembership,
    canAccessWorkspace
};
