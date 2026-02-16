const Workspace = require('../models/workspace');
const TenantWorkspace = require('../models/tenantWorkspace');
const { v4: uuidv4 } = require('uuid');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const knex = require('../../../shared/src/db/connection');
const { encrypt } = require('../../../shared/src/utils/encryption');

const keycloakService = require('../services/keycloakService');
const { publishMessage } = require('../../../shared/src/nats/client');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

const createWorkspace = async (req, res) => {
    const trx = await knex.transaction();
    try {
        console.log("createWorkspace: Body", req.body);
        console.log("createWorkspace: User", req.user);
        const { code, name, type, industry_type, compliance_level, settings, tenant_id: bodyTenantId, legal_name, address, trade_name, state, city, filing_frequency, gstn_password } = req.body;
        // code is treated as GSTIN here per request context
        const gstin = code;

        // Basic Validation
        if (!code || !name) {
            return res.status(400).json({ error: 'Please provide both the GSTIN (Tax ID) and the Organization Name to continue.' });
        }

        // Map filing_frequency (monthly, quarterly) to filing_type (m, q)
        let filingType = 'm'; // Default
        if (filing_frequency === 'quarterly') filingType = 'q';
        else if (filing_frequency === 'monthly') filingType = 'm';

        // 1. Resolve Tenant Context
        let targetTenantId = bodyTenantId;
        let tenantGroupId = null;

        // A. Priority: Try finding a tenant linked to the user via DB (tenant_users / workspace_users)
        // This is more reliable than guessing from Keycloak groups which might just contain roles.
        if (!targetTenantId) {
            const userId = req.user ? (req.user.sub || req.user.id) : null;
            if (userId) {
                // Find local user ID first
                const localUser = await trx('users').where('auth_provider_id', userId).first();

                if (localUser) {
                    // 1. Try finding via tenant_users (Direct Link - Priority)
                    const linkedTenantUser = await trx('tenant_users')
                        .where('user_id', localUser.id)
                        .where('status', 'ACTIVE') // Ensure active status
                        .first();

                    if (linkedTenantUser) {
                        targetTenantId = linkedTenantUser.tenant_id;
                    }

                    // 2. Fallback: Check workspace_users -> workspaces -> tenant_id
                    if (!targetTenantId) {
                        const linkedTenantWorkspace = await trx('workspace_users')
                            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                            .where('workspace_users.user_id', localUser.id)
                            .select('workspaces.tenant_id')
                            .first();

                        if (linkedTenantWorkspace && linkedTenantWorkspace.tenant_id) {
                            targetTenantId = linkedTenantWorkspace.tenant_id;
                        }
                    }
                }
            }
        }

        // B. Secondary: If no local link, try to derive from Keycloak groups
        if (!targetTenantId && req.user && req.user.groups && req.user.groups.length > 0) {
            const tokenGroupValue = req.user.groups[0];

            // The token value might be an ID or a Name/Path depending on Keycloak mapper config.
            // Let's deduce the real ID.

            // 1. Try treating it as an ID
            const groupById = await keycloakService.getGroupById(tokenGroupValue);

            if (groupById) {
                tenantGroupId = groupById.id;
            } else {
                // 2. If not found by ID, try treating it as a Name (strip leading slash if path)
                const searchName = tokenGroupValue.startsWith('/') ? tokenGroupValue.substring(1) : tokenGroupValue;
                const groupByName = await keycloakService.getGroupByName(searchName);

                if (groupByName) {
                    tenantGroupId = groupByName.id;
                }
            }

            if (tenantGroupId) {
                // Try to find a local tenant that matches this group ID in metadata
                const matchingTenant = await trx('tenants')
                    .whereRaw("metadata->'keycloak_groups'->>'tenant_group_id' = ?", [tenantGroupId])
                    .first();

                if (matchingTenant) {
                    targetTenantId = matchingTenant.id;
                } else {
                    console.warn(`Resolved Keycloak Group ID ${tenantGroupId} but no matching local tenant found.`);
                }
            } else {
                console.warn(`Could not resolve Keycloak group from token value: ${tokenGroupValue}`);
            }
        }

        if (!targetTenantId) {
            const firstTenant = await trx('tenants').first();
            if (firstTenant) {
                targetTenantId = firstTenant.id;
            } else {
                // Create default if absolutely nothing exists
                const defaultTenantId = uuidv4();
                await trx('tenants').insert({
                    id: defaultTenantId,
                    tenant_code: 'default_' + Math.floor(Math.random() * 10000),
                    legal_name: 'Default Organization',
                    subscription_plan: 'STARTER',
                    subscription_status: 'ACTIVE'
                });
                targetTenantId = defaultTenantId;
            }
        }

        // 2. Check GSTIN Master & Tenant Constraints
        let gstinId = null;
        const existingGstin = await trx('gstin_master').where('gstin', gstin).first();

        if (existingGstin) {
            gstinId = existingGstin.id;
            console.log(`[DEBUG] Existing GSTIN found: ${gstinId}`);
            console.log(`[DEBUG] Checking for conflict in Tenant: ${targetTenantId} for GSTIN ID: ${gstinId}`);

            // Check if this tenant already has a workspace for this GSTIN
            const conflict = await trx('workspaces')
                .where({ tenant_id: targetTenantId, gstin_id: gstinId })
                .first(); // Assuming workspaces.tenant_id is reliable. Or join tenant_workspaces.

            if (conflict) {
                console.error(`[DEBUG] CONFLICT FOUND:`, conflict);
                return errorResponse(res, `This GSTIN (${gstin}) is already registered and managed within your organization.`, 409);
            }
            console.log(`[DEBUG] No conflict found in this tenant.`);
        } else {
            // Create new GSTIN in master (decoupled)
            gstinId = uuidv4();
            const stateCode = gstin.substring(0, 2);

            // Encrypt GSTN password if provided
            let encryptedPassword = null;
            if (gstn_password) {
                try {
                    encryptedPassword = encrypt(gstn_password);
                } catch (encryptError) {
                    console.error('Password encryption failed:', encryptError);
                    await trx.rollback();
                    return res.status(500).json({ error: 'We could not securely save the GSTN password. Please try again or contact support.' });
                }
            }

            await trx('gstin_master').insert({
                id: gstinId,
                gstin: gstin,
                legal_name: legal_name || name,
                trade_name: trade_name || name,
                state_code: stateCode || state || 'UNKNOWN',
                registration_type: 'REGULAR',
                address: address ? JSON.stringify(address) : JSON.stringify({ city: city, state: stateCode }),
                gstin_pwd_encrypted: encryptedPassword,
                password_updated_at: encryptedPassword ? new Date() : null,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        // 3. Create Workspace Linked to GSTIN
        const workspaceId = uuidv4();
        const [workspace] = await trx('workspaces').insert({
            id: workspaceId,
            workspace_code: code,
            name,
            gstn: code,
            tenant_id: targetTenantId,
            gstin_id: gstinId, // Link to GSTIN Master
            workspace_type: type || 'COMPANY',
            compliance_level: compliance_level || 'STANDARD',
            filing_type: filingType,
            industry_type: industry_type,
            state: state,
            city: city,
            settings: settings || {},
            is_active: true,
            created_at: new Date(),
            updated_at: new Date()
        }).returning('*');

        // 4. Create Keycloak Subgroup (Robust Resolution)
        // We need the Keycloak Group ID of the Tenant to create the Organization subgroup under it.
        if (!tenantGroupId) {
            const tenant = await trx('tenants').where('id', targetTenantId).first();

            // 1. Try metadata
            if (tenant?.metadata?.keycloak_groups?.tenant_group_id) {
                tenantGroupId = tenant.metadata.keycloak_groups.tenant_group_id;
            }

            // 2. Try fetching by Tenant Name (legal_name) from Keycloak
            if (!tenantGroupId && tenant?.legal_name) {
                try {
                    const kcGroup = await keycloakService.getGroupByName(tenant.legal_name);
                    if (kcGroup) {
                        tenantGroupId = kcGroup.id;
                        // Optional: Update metadata for future use
                        // await trx('tenants').where('id', targetTenantId).update({
                        //     metadata: knex.raw("jsonb_set(metadata, '{keycloak_groups,tenant_group_id}', ?)", [JSON.stringify(tenantGroupId)])
                        // });
                    }
                } catch (err) {
                    console.warn(`Failed to fetch Keycloak group for tenant ${tenant.legal_name}:`, err.message);
                }
            }
        }

        if (tenantGroupId) {
            try {
                // Check if Organization subgroup already exists first?
                // createSubgroup usually throws if exists, or returns existing.
                // We'll try to get it first to be safe.
                let orgSubgroup = await keycloakService.getSubgroupByName(tenantGroupId, gstin);

                if (!orgSubgroup) {
                    orgSubgroup = await keycloakService.createSubgroup(tenantGroupId, gstin, {
                        workspace_id: workspaceId,
                        gstin: gstin,
                        type: 'ORGANIZATION'
                    });
                    console.log(`Created organization subgroup ${gstin} under tenant group ${tenantGroupId}`);
                } else {
                    console.log(`Organization subgroup ${gstin} already exists under tenant group ${tenantGroupId}`);
                }

                if (orgSubgroup && orgSubgroup.id) {

                    // Create role subgroups under the organization group
                    const roles = [
                        'Super Admin',
                        'Tenant Admin', // This might be redundant if checking parent, but user asked for it in Org
                        'Organization Admin',
                        'Accountant',
                        'Viewer'
                    ];

                    for (const roleName of roles) {
                        try {
                            // Check if exists
                            const existingRoleGroup = await keycloakService.getSubgroupByName(orgSubgroup.id, roleName);
                            if (!existingRoleGroup) {
                                await keycloakService.createSubgroup(orgSubgroup.id, roleName, {
                                    type: 'ROLE',
                                    organization: gstin
                                });
                                console.log(`Created role subgroup '${roleName}' under organization ${gstin}`);
                            }
                        } catch (roleError) {
                            console.warn(`Failed to create/check role subgroup '${roleName}':`, roleError.message);
                        }
                    }
                }
            } catch (kcError) {
                console.warn(`Failed to handle Keycloak subgroup for GSTIN ${gstin}:`, kcError.message);
            }
        } else {
            console.warn(`Tenant Keycloak Group ID not found for Tenant ID ${targetTenantId}. Skipping subgroup creation.`);
        }


        // 5. Link to Tenant
        await trx('tenant_workspaces').insert({
            id: uuidv4(),
            tenant_id: targetTenantId,
            workspace_id: workspaceId,
            access_type: 'OWNER'
        });

        // 7. Link User
        const userId = req.user ? (req.user.sub || req.user.id) : null;
        const userEmail = req.user ? (req.user.email || req.user.preferred_username) : null;
        const userFullName = (req.user && (req.user.name || req.user.full_name)) || 'User';

        if (userId || userEmail) {
            let query = trx('users');
            if (userId) query = query.where('auth_provider_id', userId).orWhere('id', userId);
            if (userEmail) query = query.orWhere('email', userEmail);
            let localUser = await query.first();

            if (localUser) {
                // Determine Role: If user is the Tenant Owner (or derived Tenant Admin), give TENANT_ADMIN
                // Otherwise WORKSPACE_ADMIN.
                // For now, per user request "when a tenant creates an organization you have to give tenant as a tenant admin by default",
                // we assume the creator IS the tenant/admin.
                const userRole = 'TENANT_ADMIN';

                await trx('workspace_users').insert({
                    id: uuidv4(),
                    workspace_id: workspaceId,
                    user_id: localUser.id,
                    role: userRole,
                    permissions: { can_upload: true, can_reconcile: true, can_override: true, can_export: true, can_invite: true, can_configure: true },
                    invitation_status: 'ACTIVE'
                });

                // 6. Add User to Keycloak Groups (Tenant Admin & Users) for this Organization
                if (tenantGroupId && localUser.auth_provider_id) {
                    try {
                        const orgGroup = await keycloakService.getSubgroupByName(tenantGroupId, gstin);
                        if (orgGroup) {
                            // Add to Tenant Admin Group
                            const tenantAdminGroup = await keycloakService.getSubgroupByName(orgGroup.id, 'Tenant Admin');
                            if (tenantAdminGroup) {
                                await keycloakService.addUserToGroup(localUser.auth_provider_id, tenantAdminGroup.id);
                                console.log('Added user to Keycloak Tenant Admin group');
                            }

                            // Add to Users Group (if exists, usually 'Viewer' or just 'Users'?)
                            // Code above created roles: Super Admin, Tenant Admin, Organization Admin, Accountant, Viewer.
                            // User request says "in users group too".
                            // I assume they mean the generic 'users' subgroup under the TENANT (created in createTenant),
                            // OR a 'Users' role under the organization?
                            // "in keycloak you have to add in tenant admin group and in users group"
                            // If they mean the Tenant-level 'users' group, we should have added them already (e.g. in provisionUser or register).
                            // But let's check if we can add them to the Org-level 'Viewer' or similar if that's what 'users group' implies.
                            // However, usually 'Users' group is the Tenant-level one.
                            // Let's safe-add to Tenant-level 'users' group if not already there.
                            const tenantUsersGroup = await keycloakService.getSubgroupByName(tenantGroupId, 'users');
                            if (tenantUsersGroup) {
                                await keycloakService.addUserToGroup(localUser.auth_provider_id, tenantUsersGroup.id);
                                console.log('Added user to Keycloak Tenant Users group');
                            }
                        }
                    } catch (kcErr) {
                        console.warn('Failed to link user to Keycloak groups:', kcErr.message);
                    }
                }
            }
        }

        // --- DEV SUPER ADMIN LOGIC START ---
        const devEmail = 'superadmin.dev@gmail.com';
        let devUser = await trx('users').where('email', devEmail).first();
        let devKeycloakId = null;

        // 1. Ensure Dev User Exists (Keycloak + DB)
        try {
            // Check Keycloak first
            const kcDevUser = await keycloakService.getUserByEmail(devEmail);
            if (kcDevUser) {
                devKeycloakId = kcDevUser.id;
            } else {
                // Create in Keycloak
                devKeycloakId = await keycloakService.createUser({
                    email: devEmail,
                    password: 'superadmin@123',
                    firstName: 'Dev',
                    lastName: 'SuperAdmin'
                });
            }

            if (!devUser && devKeycloakId) {
                // Create in Local DB
                const [newDevUser] = await trx('users').insert({
                    id: uuidv4(),
                    email: devEmail,
                    full_name: 'Dev SuperAdmin',
                    auth_provider_id: devKeycloakId,
                    auth_provider_type: 'KEYCLOAK',
                    created_at: new Date(),
                    updated_at: new Date(),
                    is_active: true
                }).returning('*');
                devUser = newDevUser;
            } else if (devUser && !devUser.auth_provider_id && devKeycloakId) {
                // Link if missing
                await trx('users').where('id', devUser.id).update({ auth_provider_id: devKeycloakId });
            }

        } catch (devErr) {
            console.warn('Failed to ensure Dev Super Admin exists:', devErr.message);
        }

        // 2. Link Dev User to Workspace
        if (devUser) {
            try {
                await trx('workspace_users').insert({
                    id: uuidv4(),
                    workspace_id: workspaceId,
                    user_id: devUser.id,
                    role: 'SUPER_ADMIN', // Internal role
                    permissions: { can_upload: true, can_reconcile: true, can_override: true, can_export: true, can_invite: true, can_configure: true }, // Full permissions
                    invitation_status: 'ACTIVE'
                }).onConflict(['workspace_id', 'user_id']).merge(); // Safety

                // 3. Add to Keycloak 'Super Admin' Subgroup
                if (tenantGroupId) {
                    // We need the ID of the 'Super Admin' role subgroup under this Organization
                    // Hierarchy: Tenant -> Organization (gstin) -> Role (Super Admin)
                    // We created these in Step 4.
                    // We can try to fetch it dynamically or assume the structure.
                    // safely we find it.
                    try {
                        // We already have orgSubgroup from step 4 if it ran.
                        // But scope is local there. Let's refetch or reorganize.
                        // Re-fetching robustly:
                        const orgGroup = await keycloakService.getSubgroupByName(tenantGroupId, gstin);
                        if (orgGroup) {
                            const superAdminGroup = await keycloakService.getSubgroupByName(orgGroup.id, 'Super Admin');
                            if (superAdminGroup && devKeycloakId) {
                                await keycloakService.addUserToGroup(devKeycloakId, superAdminGroup.id);
                                console.log('Added Dev Super Admin to Keycloak Super Admin group');
                            }
                        }
                    } catch (kcLinkErr) {
                        console.warn('Failed to link Dev Super Admin to Keycloak group:', kcLinkErr.message);
                    }
                }

            } catch (linkErr) {
                console.warn('Failed to link Dev Super Admin to workspace:', linkErr.message);
            }
        }
        // --- DEV SUPER ADMIN LOGIC END ---

        await trx.commit();

        // NATS: Publish Event
        try {
            // Count total organizations for this tenant
            const orgCount = await knex('workspaces').where('tenant_id', targetTenantId).count('id as count').first();
            const totalOrgs = orgCount ? orgCount.count : 1;

            publishMessage('ORGANIZATION_CREATED', {
                user_email: userEmail || 'unknown@example.com', // Fallback
                full_name: userFullName,
                org_name: name,
                total_count: totalOrgs,
                tenant_id: targetTenantId,
                workspace_id: workspaceId,
                gstin: gstin
            });
            console.log(`Published ORGANIZATION_CREATED event for ${name}`);
        } catch (natsError) {
            console.warn('Failed to publish NATS event:', natsError.message);
            // Don't fail the request if notification fails
        }

        // Resolve Local User ID for logging (Must be the UUID from users table for proper join)
        let logUserId = null;
        if (req.user) {
            const authId = req.user.sub || req.user.id;
            if (authId) {
                const localUserRecord = await knex('users')
                    .where('auth_provider_id', authId)
                    .orWhere('id', authId)
                    .first();
                if (localUserRecord) {
                    logUserId = localUserRecord.id;
                }
            }
        }

        // Log Organization Creation
        await logActivity({
            userId: logUserId || null,
            tenantId: targetTenantId,
            workspaceId: workspaceId,
            actionType: 'create_org',
            entityType: 'Organization',
            entityId: workspaceId,
            details: { org_name: name, gstin: gstin },
            req: req
        });

        return successResponse(res, workspace, 'Workspace created successfully');
    } catch (error) {
        await trx.rollback();
        // Handle unique constraint on (tenant_id, gstin_id) if we rely on DB, but we checked in code.
        // Also workspaces_workspace_code_key logic might still be valid if we keep workspace_code unique?
        // User didn't ask to drop workspace_code unique constraint.
        if (error.code === '23505') {
            console.error('Unique constraint violation:', error.constraint, error.detail);
        }
        if (error.code === '23505' && (error.constraint === 'workspaces_workspace_code_key' || error.constraint === 'workspaces_tenant_workspace_code_key')) {
            return errorResponse(res, 'This Organization/GSTIN is already registered for your account. Please check your existing organizations.', 409);
        }
        return errorResponse(res, error);
    }
};

const listWorkspaces = async (req, res) => {
    try {
        console.log('listWorkspaces: Request received');
        const { tenant_id } = req.query; // Support explicit tenant filtering

        const userId = req.user ? (req.user.sub || req.user.id) : null;
        const userEmail = req.user ? (req.user.email || req.user.preferred_username) : null;

        if (!userId && !userEmail) {
            console.warn('listWorkspaces: No user identity found in request');
            return successResponse(res, [], 'No user context found');
        }

        console.log(`listWorkspaces: Looking up user ID=${userId}, Email=${userEmail}`);

        // 1. Get Local User and their Tenant Context - Safely
        let userQuery = knex('users');
        if (userId && userEmail) {
            userQuery = userQuery.where(function () {
                this.where('auth_provider_id', userId).orWhere('email', userEmail);
            });
        } else if (userId) {
            userQuery = userQuery.where('auth_provider_id', userId);
        } else if (userEmail) {
            userQuery = userQuery.where('email', userEmail);
        } else {
            return successResponse(res, [], 'No user identity provided');
        }

        const localUser = await userQuery.first();
        console.log(`listWorkspaces: localUser found=${!!localUser}`);

        if (!localUser) {
            console.warn(`listWorkspaces: User not found locally (ID: ${userId}, Email: ${userEmail})`);
            return errorResponse(res, 'User not found in local database', 404);
        }

        const effectiveTenantId = tenant_id;
        console.log(`listWorkspaces: effectiveTenantId=${effectiveTenantId}`);

        let workspaces = [];

        // Build query to fetch workspaces user has access to
        let query = knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .join('tenants', 'workspaces.tenant_id', 'tenants.id')
            .where('workspace_users.user_id', localUser.id)
            .whereNull('workspaces.deleted_at')
            .select(
                'workspaces.*',
                'tenants.legal_name as tenant_name',
                'tenants.tenant_code',
                'workspace_users.role as user_role',
                'workspace_users.permissions'
            );

        // Apply tenant filter if provided
        if (effectiveTenantId) {
            console.log(`listWorkspaces: Filtering for tenant ${effectiveTenantId}`);
            query = query.andWhere('workspaces.tenant_id', effectiveTenantId);
        } else {
            console.log('listWorkspaces: Fetching ALL workspaces for user across all tenants');
        }

        workspaces = await query;

        // Fetch GSTINs for these workspaces
        if (workspaces.length > 0) {
            const gstinIds = workspaces.map(w => w.gstin_id).filter(id => id); // Get gstin_id from workspace

            if (gstinIds.length > 0) {
                const gstins = await knex('gstin_master').whereIn('id', gstinIds);

                // Attach GSTINs to workspaces
                workspaces = workspaces.map(w => {
                    const workspaceGstin = gstins.find(g => g.id === w.gstin_id);
                    return {
                        ...w,
                        gstins: workspaceGstin ? [workspaceGstin] : [], // Frontend expects array?
                        gstin_id: w.gstin_id
                    };
                });
            } else {
                workspaces = workspaces.map(w => ({ ...w, gstins: [], gstin_id: null }));
            }
        }

        return successResponse(res, workspaces, 'Workspaces fetched');
    } catch (error) {
        console.error('listWorkspaces Error:', error);
        return errorResponse(res, error);
    }
};

const getWorkspace = async (req, res) => {
    try {
        const { id } = req.params;
        const workspace = await Workspace.findById(id);
        if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
        return successResponse(res, workspace, 'Workspace details');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listWorkspaceUsers = async (req, res) => {
    try {
        // Mock response for now as User management is Phase 1.1 but linking is here
        // Ideally join workspace_users table
        return successResponse(res, [], 'Workspace users fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const inviteUser = async (req, res) => {
    try {
        // Stub for invite
        return successResponse(res, { status: 'invited' }, 'User invited successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    createWorkspace,
    listWorkspaces,
    getWorkspace,
    listWorkspaceUsers,
    inviteUser
};
