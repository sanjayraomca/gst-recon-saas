/**
 * Tenant-level access checks that are always resolved from the database.
 *
 * A tenant is the top-level "company" record; workspaces (organisations /
 * GSTINs) belong to a tenant, and a user belongs to a tenant either as its
 * registered owner (tenants.owner_user_id), via users.tenant_id (their home
 * tenant, set at signup or when invited), or via an ACTIVE workspace_users
 * membership in one of that tenant's workspaces.
 *
 * Never decide tenant membership or admin rights from a request body field
 * (e.g. req.body.tenant_id) or from a JWT claim — those are attacker
 * controlled. Always resolve from req.user.db_id (the verified internal
 * users.id set by authMiddleware) against the tables below.
 */
const knex = require('../db/connection');
const { isPlatformSuperAdminById, UUID_RE } = require('./workspaceAccess');

/** True if dbUserId is the tenant's registered owner. */
const isTenantOwner = async (dbUserId, tenantId) => {
    if (!dbUserId || !tenantId || !UUID_RE.test(String(dbUserId)) || !UUID_RE.test(String(tenantId))) return false;
    const tenant = await knex('tenants').where({ id: tenantId }).select('owner_user_id').first();
    return !!(tenant && tenant.owner_user_id === dbUserId);
};

/**
 * True if dbUserId belongs to tenantId in any capacity: owner, home tenant
 * (users.tenant_id), or an active member of one of the tenant's workspaces.
 */
const belongsToTenant = async (dbUserId, tenantId) => {
    if (!dbUserId || !tenantId || !UUID_RE.test(String(dbUserId)) || !UUID_RE.test(String(tenantId))) return false;

    const user = await knex('users').where({ id: dbUserId }).select('tenant_id').first();
    if (user && user.tenant_id === tenantId) return true;

    if (await isTenantOwner(dbUserId, tenantId)) return true;

    const membership = await knex('workspace_users')
        .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
        .where('workspace_users.user_id', dbUserId)
        .andWhere('workspaces.tenant_id', tenantId)
        .andWhere('workspace_users.invitation_status', 'ACTIVE')
        .whereNull('workspace_users.removed_at')
        .first();
    return !!membership;
};

/** Read access to a tenant's own data: platform admin, or belongs to it. */
const canAccessTenant = async (dbUserId, tenantId) => {
    if (await isPlatformSuperAdminById(dbUserId)) return true;
    return belongsToTenant(dbUserId, tenantId);
};

/**
 * Admin access to a tenant: platform admin, the tenant's owner, or an ACTIVE
 * TENANT_ADMIN / SUPER_ADMIN workspace role in one of the tenant's
 * workspaces. This is who may invite/remove users, change roles, edit
 * tenant settings, or deactivate the tenant.
 */
const isTenantAdmin = async (dbUserId, tenantId) => {
    if (await isPlatformSuperAdminById(dbUserId)) return true;
    if (await isTenantOwner(dbUserId, tenantId)) return true;

    if (!dbUserId || !tenantId || !UUID_RE.test(String(dbUserId)) || !UUID_RE.test(String(tenantId))) return false;
    const adminMembership = await knex('workspace_users')
        .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
        .where('workspace_users.user_id', dbUserId)
        .andWhere('workspaces.tenant_id', tenantId)
        .andWhere('workspace_users.invitation_status', 'ACTIVE')
        .whereNull('workspace_users.removed_at')
        .whereIn('workspace_users.role', ['TENANT_ADMIN', 'SUPER_ADMIN'])
        .first();
    return !!adminMembership;
};

/**
 * True only if workspaceId actually belongs to tenantId. Closes the IDOR
 * where a caller who is an admin of Tenant A passes a workspace_id that
 * actually belongs to Tenant B into a "tenant-scoped" write, and the write
 * silently applies to Tenant B's workspace instead.
 */
const workspaceBelongsToTenant = async (workspaceId, tenantId) => {
    if (!workspaceId || !tenantId || !UUID_RE.test(String(workspaceId)) || !UUID_RE.test(String(tenantId))) return false;
    const ws = await knex('workspaces').where({ id: workspaceId, tenant_id: tenantId }).first();
    return !!ws;
};

module.exports = {
    isTenantOwner,
    belongsToTenant,
    canAccessTenant,
    isTenantAdmin,
    workspaceBelongsToTenant
};
