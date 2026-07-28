const Tenant = require('../models/tenantModel');
const keycloakService = require('../services/keycloakService');
const crypto = require('crypto');
const User = require('../models/userModel');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { publishMessage } = require('../../../shared/src/nats/client');
const knex = require('../../../shared/src/db/connection');

const createTenant = async (req, res) => {
    try {
        const {
            tenant_code,
            legal_name,
            trading_name,
            pan,
            contact_email,
            contact_phone,
            address,
            subscription_plan = 'STARTER'
        } = req.body;

        // Validation
        if (!tenant_code || !legal_name) {
            return errorResponse(res, 'Please provide a unique Organization Code and your Legal Entity Name.', 400);
        }

        // Check for duplicate tenant code
        const existing = await Tenant.findByCode(tenant_code);
        if (existing) {
            return errorResponse(res, 'This Organization Code is already taken. Please choose a different one.', 409);
        }

        const tenantId = crypto.randomUUID();

        // Prepare tenant data
        const tenantData = {
            id: tenantId,
            tenant_code,
            legal_name,
            trading_name,
            pan,
            contact_email,
            contact_phone,
            address: address ? JSON.stringify(address) : null,
            subscription_plan,
            subscription_status: 'ACTIVE',
            metadata: {},
            created_at: new Date(),
            updated_at: new Date()
        };

        // Create Keycloak group for tenant using tenant UUID
        let keycloakGroupId = null;
        const groupName = tenantId; // Changed from `tenant_${tenantId}` to just uuid

        try {
            const group = await keycloakService.createGroup(groupName, {
                tenant_id: tenantId,
                tenant_code: tenant_code
            });
            keycloakGroupId = group.id;

            // Optional: If there's a user associated with the request (e.g. from token), add them to group
            if (req.user && req.user.sub) {
                await keycloakService.addUserToGroup(req.user.sub, keycloakGroupId);
            }

            // Create "users" subgroup under tenant group
            let usersSubgroupId = null;
            try {
                const usersSubgroup = await keycloakService.createSubgroup(keycloakGroupId, 'users', {
                    description: 'All users of this tenant'
                });
                if (usersSubgroup) {
                    usersSubgroupId = usersSubgroup.id;
                    console.log(`Created 'users' subgroup under tenant ${groupName}`);
                }
            } catch (subgroupError) {
                console.warn('Failed to create users subgroup:', subgroupError.message);
            }

            // Store Keycloak group ID in metadata
            tenantData.metadata = {
                keycloak_groups: {
                    tenant_group_id: keycloakGroupId,
                    tenant_group_name: groupName,
                    users_subgroup_id: usersSubgroupId,
                    gstin_groups: {}
                }
            };
        } catch (kcError) {
            console.warn('Failed to create Keycloak group for tenant:', kcError.message);
            // Continue with tenant creation even if Keycloak fails
            tenantData.metadata = {
                keycloak_groups: {
                    tenant_group_id: null,
                    tenant_group_name: groupName,
                    gstin_groups: {},
                    error: kcError.message
                }
            };
        }

        // Create tenant in database
        const tenant = await Tenant.create(tenantData);

        // Log Activity
        const performer = req.user ? await User.findByEmail(req.user.email) : null;
        await logActivity({
            userId: performer ? performer.id : null,
            tenantId: tenant.id,
            actionType: 'create_org',
            entityType: 'Tenant',
            entityId: tenant.id,
            details: {
                tenant_code: tenant.tenant_code,
                legal_name: tenant.legal_name,
                creator_email: req.user ? req.user.email : 'system'
            },
            req
        });

        return successResponse(res, {
            tenant,
            keycloak_group_id: keycloakGroupId
        }, 'Tenant created successfully', 201);

    } catch (error) {
        return errorResponse(res, error);
    }
};

const getTenant = async (req, res) => {
    try {
        const { id } = req.params;
        const includeWorkspaces = req.query.include_workspaces === 'true';

        let tenant;
        if (includeWorkspaces) {
            tenant = await Tenant.findWithWorkspaces(id);
        } else {
            tenant = await Tenant.findById(id);
        }

        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        return successResponse(res, tenant, 'Tenant retrieved successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const listTenants = async (req, res) => {
    try {
        const filters = {
            subscription_status: req.query.subscription_status,
            subscription_plan: req.query.subscription_plan,
            search: req.query.search
        };

        const pagination = {
            page: req.query.page || 1,
            limit: req.query.limit || 20
        };

        // Enriched query with counts
        let query = knex('tenants as t')
            .select(
                't.*',
                knex.raw('(SELECT COUNT(*) FROM workspaces w WHERE w.tenant_id = t.id AND w.deleted_at IS NULL) as organization_count'),
                knex.raw('CAST((SELECT COUNT(DISTINCT user_id) FROM (SELECT wu.user_id FROM workspace_users wu JOIN workspaces w ON wu.workspace_id = w.id WHERE w.tenant_id = t.id AND w.deleted_at IS NULL UNION SELECT owner_user_id FROM tenants WHERE id = t.id UNION SELECT id FROM users WHERE tenant_id = t.id) as all_users) AS INTEGER) as user_count')
            )
            .whereNull('t.deleted_at');

        // Apply filters (matching TenantModel logic but adding counts)
        if (filters.subscription_status) {
            query = query.where('t.subscription_status', filters.subscription_status);
        }
        if (filters.subscription_plan) {
            query = query.where('t.subscription_plan', filters.subscription_plan);
        }
        if (filters.search) {
            query = query.where(function () {
                this.where('t.legal_name', 'ilike', `%${filters.search}%`)
                    .orWhere('t.trading_name', 'ilike', `%${filters.search}%`)
                    .orWhere('t.tenant_code', 'ilike', `%${filters.search}%`);
            });
        }

        const page = parseInt(pagination.page) || 1;
        const limit = parseInt(pagination.limit) || 100; // Increased default for admin list
        const offset = (page - 1) * limit;

        const tenants = await query
            .orderBy('t.created_at', 'desc')
            .limit(limit)
            .offset(offset);

        return successResponse(res, tenants);
    } catch (error) {
        console.error('List Tenants Error:', error);
        return errorResponse(res, error);
    }
};

const updateTenant = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Check if tenant exists
        const existing = await Tenant.findById(id);
        if (!existing) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // Whitelist allowed updates
        const allowedFields = [
            'legal_name',
            'trading_name',
            'pan',
            'contact_email',
            'contact_phone',
            'address',
            'subscription_plan',
            'subscription_status'
        ];

        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });

        if (filteredUpdates.address) {
            filteredUpdates.address = JSON.stringify(filteredUpdates.address);
        }

        if (Object.keys(filteredUpdates).length === 0) {
            return errorResponse(res, 'No valid fields to update', 400);
        }

        const tenant = await Tenant.update(id, filteredUpdates);

        const userId = req.user ? req.user.id : null;
        await logActivity({
            userId: userId,
            tenantId: id,
            actionType: 'UPDATE_TENANT',
            entityType: 'Tenant',
            entityId: id,
            details: { updates: Object.keys(filteredUpdates) },
            req: req
        });

        return successResponse(res, tenant, 'Tenant updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const deleteTenant = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if tenant exists
        const existing = await Tenant.findById(id);
        if (!existing) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // Check if already inactive
        if (existing.subscription_status === 'INACTIVE') {
            return errorResponse(res, 'Tenant is already inactive', 400);
        }

        // Set subscription_status to INACTIVE (do not delete Keycloak groups)
        const tenant = await Tenant.update(id, {
            subscription_status: 'INACTIVE'
        });

        return successResponse(res, tenant, 'Tenant deactivated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const registerTenant = async (req, res) => {
    try {
        let { email, password, full_name, phone, recaptcha_token } = req.body;
        const User = require('../models/userModel');
        const axios = require('axios'); // Ensure axios is required

        if (!email || !password || !full_name) {
            return errorResponse(res, 'All fields (Email, Password, and Full Name) are required to create your account.', 400);
        }

        // Normalize email
        email = email.toLowerCase();

        // Verify reCAPTCHA
        if (!process.env.RECAPTCHA_SECRET_KEY) {
            console.warn("RECAPTCHA_SECRET_KEY is missing. Skipping verification.");
        } else {
            if (!recaptcha_token) {
                return errorResponse(res, 'reCAPTCHA token is missing', 400);
            }

            try {
                const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptcha_token}`;
                const recaptchaResponse = await axios.post(verificationUrl);

                if (!recaptchaResponse.data.success) {
                    console.error("reCAPTCHA Verification Failed:", recaptchaResponse.data);
                    return errorResponse(res, 'reCAPTCHA verification failed', 400);
                }
            } catch (recaptchaError) {
                console.error("reCAPTCHA Error:", recaptchaError.message);
                return errorResponse(res, 'Failed to verify reCAPTCHA', 500);
            }
        }

        // 1. Create User in Keycloak
        let keycloakId;
        const nameParts = full_name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'User';

        try {
            keycloakId = await keycloakService.createUser({
                email,
                password,
                firstName,
                lastName
            });
        } catch (kcError) {
            if (kcError.message === 'User already exists in Keycloak') {
                const kcUser = await keycloakService.getUserByEmail(email);
                if (kcUser) keycloakId = kcUser.id;
            } else {
                throw kcError;
            }
        }

        if (!keycloakId) {
            throw new Error('Failed to retrieve Keycloak ID');
        }

        // 2. Check Local User
        let user = await User.findByEmail(email);
        // REMOVED: Check that blocks existing users

        // Start Transaction for DB operations
        const knex = require('../../../shared/src/db/connection');
        const trx = await knex.transaction();

        try {
            // 3. Create Tenant
            const tenantId = crypto.randomUUID();

            // Generate Tenant Code: First 3 chars of name + Sequential Number (001, 002...)
            const prefix = full_name.substring(0, 3).toUpperCase();
            const similarTenants = await trx('tenants')
                .where('tenant_code', 'like', `${prefix}%`)
                .count('id as count');

            const nextNum = parseInt(similarTenants[0].count) + 1;
            const tenantCode = `${prefix}${String(nextNum).padStart(5, '0')}`;

            // 3A. Create user first (WITHOUT tenant_id to avoid FK violation)
            let userId;

            if (user) {
                // User exists - reuse ID and update designation
                userId = user.id;
                await trx('users').where({ id: userId }).update({
                    designation: 'TENANT_ADMIN',
                    updated_at: new Date()
                });
                console.log(`Linking existing user ${email} (ID: ${userId}) to new tenant, updated designation to TENANT_ADMIN`);
            } else {
                // New user - create record
                userId = crypto.randomUUID();
                const [newUser] = await trx('users').insert({
                    id: userId,
                    email,
                    full_name,
                    phone,
                    designation: 'TENANT_ADMIN',
                    auth_provider_id: keycloakId,
                    auth_provider_type: 'KEYCLOAK',
                    created_at: new Date(),
                    updated_at: new Date()
                }).returning('*');
                user = newUser;
            }

            // 3B. Create tenant with owner reference
            let [tenant] = await trx('tenants').insert({
                id: tenantId,
                owner_user_id: userId,
                tenant_code: tenantCode,
                legal_name: full_name, // Use same name as signup full_name
                subscription_plan: 'STARTER',
                subscription_status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date()
            }).returning('*');

            // 3C. Now update user with tenant_id (now that tenant exists)
            await trx('users').where({ id: userId }).update({
                tenant_id: tenantId,
                updated_at: new Date()
            });
            console.log(`Updated user ${email} (ID: ${userId}) with tenant_id ${tenantId}`);



            // 4. (Removed) Create Default Workspace for the Tenant
            // 5. (Removed) Link User to the Default Workspace

            // Create Keycloak group for tenant
            const groupName = tenantId; // Changed from `tenant_${tenantId}` to just uuid
            try {
                const group = await keycloakService.createGroup(groupName, {
                    tenant_id: tenantId,
                    tenant_code: tenantCode
                });
                if (group) {
                    // Link user to the new group
                    await keycloakService.addUserToGroup(keycloakId, group.id);

                    const [updatedTenant] = await trx('tenants').where({ id: tenantId }).update({
                        metadata: JSON.stringify({
                            keycloak_groups: {
                                tenant_group_id: group.id,
                                tenant_group_name: groupName,
                                gstin_groups: {}
                            }
                        })
                    }).returning('*');

                    if (updatedTenant) {
                        tenant = updatedTenant;
                        console.log(`Successfully updated metadata for tenant ${tenantId}`);
                    }
                } else {
                    console.warn(`Keycloak group creation returned null for tenant ${tenantId}`);
                }
            } catch (kcGroupError) {
                console.error(`Failed to create Keycloak group during registration for tenant ${tenantId}:`, kcGroupError.message);
            }

            await trx.commit();

            // Publish Event
            publishMessage('TENANT_REGISTERED', {
                email: user.email,
                full_name: user.full_name,
                tenant_code: tenant.tenant_code,
                tenant_id: tenant.id
            });

            // Log Activity
            await logActivity({
                userId: user.id,
                tenantId: tenant.id,
                actionType: 'tenant_registered',
                entityType: 'Tenant',
                entityId: tenant.id,
                details: { email: user.email },
                req
            });

            return successResponse(res, { user, tenant }, 'Tenant and user registered successfully', 201);
        } catch (dbError) {
            await trx.rollback();
            throw dbError;
        }
    } catch (error) {
        return errorResponse(res, error);
    }
};



const provisionUser = async (req, res) => {
    try {
        let { email, full_name, phone_number, role, organization_ids } = req.body;
        const tenantId = req.params.id; // Corrected from req.params.tenantId to match route

        if (!email) {
            return errorResponse(res, 'Email is required', 400);
        }

        // Normalize email
        email = email.toLowerCase();

        // 1. Check Tenant
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        const tenantGroupId = tenant.metadata?.keycloak_groups?.tenant_group_id;
        if (!tenantGroupId) {
            console.error('Tenant Metadata:', JSON.stringify(tenant.metadata));
            return errorResponse(res, 'Tenant Keycloak group not configured', 500);
        }

        // 2. Check if user exists in Keycloak or Local DB
        const User = require('../models/userModel');
        let localUser = await User.findByEmail(email);
        let kcUser = await keycloakService.getUserByEmail(email);
        let keycloakId = kcUser ? kcUser.id : null;

        // A user is "new" only if they don't exist in Keycloak AND don't exist in our DB
        let isNewUser = !keycloakId && !localUser;

        if (isNewUser) {
            // Create user in Keycloak with a temp password
            const tempPassword = crypto.randomUUID().slice(0, 12);
            const nameParts = full_name.split(' ');
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ') || 'User';

            try {
                keycloakId = await keycloakService.createUser({
                    email,
                    password: tempPassword,
                    firstName,
                    lastName
                });
            } catch (kcError) {
                console.error('Failed to create user in Keycloak:', kcError.message);
                throw kcError;
            }
        }

        if (!keycloakId) {
            throw new Error('Failed to resolve Keycloak ID for user');
        }

        // 3. Ensure User is in Tenant's 'users' group in Keycloak
        let usersSubgroupId = tenant.metadata?.keycloak_groups?.users_subgroup_id;
        if (tenantGroupId && !usersSubgroupId) {
            try {
                const existingUsersGroup = await keycloakService.getSubgroupByName(tenantGroupId, 'users');
                usersSubgroupId = existingUsersGroup ? existingUsersGroup.id : null;
            } catch (e) { console.warn('Subgroup check failed', e.message); }
        }

        if (usersSubgroupId) {
            await keycloakService.addUserToGroup(keycloakId, usersSubgroupId);
        }

        // 4. Update/Create Local User
        // ALWAYS generate token for invitations (both new and existing users)
        const invitationToken = crypto.randomUUID();
        const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const userData = {
            full_name,
            phone: phone_number,
            designation: role,
            tenant_id: tenantId,
            auth_provider_id: keycloakId,
            auth_provider_type: 'KEYCLOAK',
            // CRITICAL: New users are INACTIVE until they accept invite. Existing users stay as they are.
            is_active: localUser ? localUser.is_active : false,
            invitation_token: invitationToken,
            invitation_expires_at: invitationExpiresAt,
            updated_at: new Date()
        };

        let user;
        if (localUser) {
            user = await User.update(localUser.id, userData);
        } else {
            userData.id = crypto.randomUUID();
            userData.email = email;
            userData.created_at = new Date();
            user = await User.create(userData);
        }

        // 5. Link to Workspaces and Assign Keycloak Groups
        const knex = require('../../../shared/src/db/connection');

        let workspaceRole = 'VIEWER';
        switch (role) {
            case 'Super Admin': workspaceRole = 'SUPER_ADMIN'; break;
            case 'Tenant Admin': workspaceRole = 'TENANT_ADMIN'; break;
            case 'Organization Admin': workspaceRole = 'WORKSPACE_ADMIN'; break;
            case 'Accountant': workspaceRole = 'ACCOUNTANT'; break;
            case 'Viewer': workspaceRole = 'VIEWER'; break;
            case 'Auditor': workspaceRole = 'AUDITOR'; break;
            case 'GST Practitioner': workspaceRole = 'GST_PRACTITIONER'; break;
            default: workspaceRole = 'VIEWER';
        }

        const workspaces = await knex('workspaces')
            .whereIn('id', organization_ids)
            .andWhere({ tenant_id: tenantId });

        if (workspaces.length > 0) {
            const workspaceUsers = workspaces.map(ws => ({
                id: crypto.randomUUID(),
                workspace_id: ws.id,
                user_id: user.id,
                role: workspaceRole,
                invitation_status: 'INVITED', // Always 'INVITED' initially
                joined_at: new Date()
            }));

            await knex('workspace_users')
                .insert(workspaceUsers)
                .onConflict(['workspace_id', 'user_id'])
                .merge();

            // Keycloak Group Assignment for each organization
            for (const workspace of workspaces) {
                try {
                    if (tenantGroupId) {
                        // Find or create Org Subgroup (GSTIN)
                        let orgGroup = await keycloakService.getSubgroupByName(tenantGroupId, workspace.workspace_code); // workspace_code is GSTIN
                        if (!orgGroup) {
                            // Attempt to create if missing (though it should exist from workspace creation)
                            orgGroup = await keycloakService.createSubgroup(tenantGroupId, workspace.workspace_code, {
                                type: 'ORGANIZATION',
                                workspace_id: workspace.id
                            });
                        }

                        if (orgGroup) {
                            // Find or create Role Subgroup under Org
                            let roleGroup = await keycloakService.getSubgroupByName(orgGroup.id, role);
                            if (!roleGroup) {
                                roleGroup = await keycloakService.createSubgroup(orgGroup.id, role, {
                                    type: 'ROLE',
                                    organization: workspace.workspace_code
                                });
                            }

                            if (roleGroup) {
                                await keycloakService.addUserToGroup(keycloakId, roleGroup.id);
                                console.log(`Added user ${email} to Keycloak group: ${workspace.workspace_code} > ${role}`);
                            }
                        }
                    }
                } catch (kcGroupErr) {
                    console.warn(`Keycloak group assignment failed for workspace ${workspace.id}:`, kcGroupErr.message);
                }
            }
        }

        // 6. Send Notifications
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteLink = `${frontendUrl}/accept-invite?token=${invitationToken}`;

        // ALWAYS send invitation (even for existing users) as per request
        publishMessage('USER_INVITED', {
            email: user.email,
            user_name: user.full_name,
            inviter_name: req.user ? (req.user.name || 'Admin') : 'Admin',
            tenant_name: tenant.legal_name,
            org_names: workspaces.map(w => w.name),
            role: role,
            invite_link: inviteLink,
            is_existing_user: !isNewUser
        });


        // 7. Log Activity (Per Workspace for isolation)
        // Resolve inviter's internal UUID for logging
        let inviterId = null;
        if (req.user && req.user.sub) {
            const inviter = await knex('users').where('auth_provider_id', req.user.sub).first();
            if (inviter) inviterId = inviter.id;
        }

        for (const workspace of workspaces) {
            await logActivity({
                userId: inviterId,
                tenantId: tenantId,
                workspaceId: workspace.id,
                actionType: isNewUser ? 'user_invited' : 'user_added_to_org',
                entityType: 'User',
                entityId: user.id,
                details: {
                    target_user_email: email,
                    role: role
                },
                req
            });
        }

        return successResponse(res, {
            user,
            status: isNewUser ? 'invited' : 'linked',
            invitation_token: invitationToken
        }, isNewUser ? 'User invited successfully' : 'Existing user added to organizations');

    } catch (error) {
        console.error('ProvisionUser Error:', error);
        return errorResponse(res, error);
    }
};

const listTenantUsers = async (req, res) => {
    try {
        const { id: tenantId } = req.params;
        const { workspaceId } = req.query;

        // 1. Check Tenant
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        let users = [];
        const knex = require('../../../shared/src/db/connection');

        let rawQuery;
        if (workspaceId) {
            // 1. WORKSPACE-SPECIFIC LIST (Strict isolation)
            rawQuery = knex('users')
                .select(
                    'users.id',
                    'users.full_name',
                    'users.email',
                    'users.phone',
                    knex.raw('CASE WHEN users.id = ? THEN users.designation ELSE NULL END as designation', [tenant.owner_user_id]),
                    'users.is_active',
                    'users.last_login_at',
                    'users.created_at',
                    'workspace_users.invitation_status as invitation_status',
                    knex.raw('CAST(COUNT(DISTINCT CASE WHEN workspaces.tenant_id = ? THEN workspaces.id END) AS INTEGER) as organization_count', [tenantId]),
                    knex.raw('MAX(workspace_users.role) as role'),
                    knex.raw('COALESCE(array_agg(DISTINCT workspaces.id) FILTER (WHERE workspaces.id IS NOT NULL), \'{}\') as organization_ids'),
                    knex.raw('COALESCE(array_agg(DISTINCT workspaces.name) FILTER (WHERE workspaces.name IS NOT NULL), \'{}\') as organization_names')
                )
                .join('workspace_users', 'users.id', 'workspace_users.user_id')
                .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                .where('workspaces.id', workspaceId)
                .whereNot('users.email', 'superadmin.dev@gmail.com')
                .groupBy('users.id', 'users.full_name', 'users.email', 'users.phone', 'users.designation', 'users.is_active', 'users.last_login_at', 'users.created_at', 'workspace_users.invitation_status');
        } else {
            // 2. ALL-TENANT LIST (Anyone linked to any workspace in this tenant, plus the owner)
            rawQuery = knex('users')
                .select(
                    'users.id',
                    'users.full_name',
                    'users.email',
                    'users.phone',
                    knex.raw('CASE WHEN users.id = ? THEN users.designation ELSE NULL END as designation', [tenant.owner_user_id]),
                    'users.is_active',
                    'users.last_login_at',
                    'users.created_at',
                    // Aggregate status: Active if ALREADY accepted ANY invite in this tenant, else Pending
                    knex.raw("CASE WHEN bool_or(workspace_users.invitation_status = 'ACTIVE') THEN 'ACTIVE' ELSE 'INVITED' END as invitation_status"),
                    knex.raw('CAST(COUNT(DISTINCT CASE WHEN workspaces.tenant_id = ? THEN workspaces.id END) AS INTEGER) as organization_count', [tenantId]),
                    knex.raw('MAX(workspace_users.role) as role'),
                    knex.raw('COALESCE(array_agg(DISTINCT workspaces.id) FILTER (WHERE workspaces.id IS NOT NULL AND workspaces.tenant_id = ?), \'{}\') as organization_ids', [tenantId]),
                    knex.raw('COALESCE(array_agg(DISTINCT workspaces.name) FILTER (WHERE workspaces.name IS NOT NULL AND workspaces.tenant_id = ?), \'{}\') as organization_names', [tenantId])
                )
                .leftJoin('workspace_users', 'users.id', 'workspace_users.user_id')
                .leftJoin('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                .whereNot('users.email', 'superadmin.dev@gmail.com')
                .where(function () {
                    this.where('workspaces.tenant_id', tenantId)
                        .orWhere('users.id', tenant.owner_user_id);
                })
                .groupBy('users.id', 'users.full_name', 'users.email', 'users.phone', 'users.designation', 'users.is_active', 'users.last_login_at', 'users.created_at');
        }

        users = await rawQuery;

        // Map internal status to 'Active'/ 'Pending' for frontend
        const formattedUsers = users.map(u => ({
            ...u,
            status: u.invitation_status === 'ACTIVE' ? 'Active' : (u.invitation_status === 'INVITED' ? 'Pending' : 'Inactive')
        }));

        return successResponse(res, formattedUsers, 'Tenant users retrieved successfully');

    } catch (error) {
        return errorResponse(res, error);
    }
};

const getTenantActivities = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { limit = 50, offset = 0, workspaceId, type, search } = req.query;

        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant ID is required' });
        }

        // Fetch activity logs for this tenant with user information
        const database = require('../../../shared/src/db/connection');
        let query = database('activity_logs')
            .leftJoin('users', 'activity_logs.user_id', 'users.id')
            .where('activity_logs.tenant_id', tenantId)
            .where(function () {
                this.whereNot('users.email', 'superadmin.dev@gmail.com')
                    .orWhereNull('users.email');
            });

        if (workspaceId) {
            query = query.where('activity_logs.workspace_id', workspaceId);
        }

        if (type && type !== 'ALL') {
            const typeLower = type.toLowerCase();
            if (typeLower === 'notices') {
                query = query.whereIn('activity_logs.entity_type', ['NOTICE', 'GST_NOTICE']);
            } else if (typeLower === 'tax liabilities') {
                query = query.whereIn('activity_logs.action_type', ['LIABILITY_DUE', 'PAYMENT_PENDING']);
            } else if (typeLower === 'user actions') {
                query = query.whereIn('activity_logs.entity_type', ['USER', 'AUTH']);
            } else {
                query = query.where('activity_logs.action_type', type);
            }
        }

        if (search) {
            query = query.where(function () {
                this.where(database.raw('activity_logs.details::text'), 'ilike', `%${search}%`)
                    .orWhere('activity_logs.action_type', 'ilike', `%${search}%`)
                    .orWhere('users.full_name', 'ilike', `%${search}%`)
                    .orWhere('users.email', 'ilike', `%${search}%`);
            });
        }

        const activities = await query
            .select(
                'activity_logs.id',
                'activity_logs.user_id',
                'activity_logs.tenant_id',
                'activity_logs.workspace_id',
                'activity_logs.action_type',
                'activity_logs.entity_type',
                'activity_logs.entity_id',
                'activity_logs.details',
                'activity_logs.ip_address',
                'activity_logs.user_agent',
                'activity_logs.created_at',
                'users.full_name as user_name',
                'users.email as user_email'
            )
            .orderBy('activity_logs.created_at', 'desc')
            .limit(parseInt(limit))
            .offset(parseInt(offset));

        // Format the response to include action descriptions
        const formattedActivities = activities.map(activity => {
            let actionDescription = '';
            let entityType = activity.entity_type || 'general';

            const actionType = activity.action_type?.toLowerCase();
            // Generate human-readable descriptions based on action_type
            switch (actionType) {
                case 'user_created':
                case 'user_invited':
                    actionDescription = `Created new user: ${activity.details?.target_user_email || 'New User'}`;
                    entityType = 'user management';
                    break;
                case 'user_added_to_org':
                    actionDescription = `User added to org: ${activity.details?.target_user_email || 'Existing User'}`;
                    entityType = 'user management';
                    break;
                case 'user_login':
                    actionDescription = `${activity.user_name || activity.user_email} logged in`;
                    entityType = 'auth';
                    break;
                case 'settings_updated':
                    actionDescription = `Updated ${activity.details?.setting_name || 'system'} settings`;
                    entityType = 'settings';
                    break;
                case 'report_generated':
                    actionDescription = `Generated ${activity.details?.report_name || 'compliance'} report`;
                    entityType = 'reports';
                    break;
                case 'reconciliation_run':
                    actionDescription = `Ran reconciliation for ${activity.details?.period || 'November 2024'}`;
                    entityType = 'reconciliation';
                    break;
                case 'import_data':
                    actionDescription = `Imported ${activity.details?.data_type || 'purchase'} data`;
                    entityType = 'data import';
                    break;
                case 'data_viewed':
                    actionDescription = `Viewed ${activity.details?.view_name || 'dashboard'}`;
                    entityType = 'view';
                    break;
                case 'create_org':
                    actionDescription = `Created new organization: ${activity.details?.org_name || activity.details?.name || 'TaxCorp Solutions'}`;
                    entityType = 'org management';
                    break;
                default:
                    actionDescription = activity.action_type.replace(/_/g, ' ');
            }

            return {
                ...activity,
                action_description: actionDescription,
                entity_type: entityType
            };
        });

        return successResponse(res, formattedActivities, 'Activities fetched successfully');
    } catch (error) {
        console.error('Error fetching tenant activities:', error);
        return errorResponse(res, error);
    }
};

const getTenantStats = async (req, res) => {
    try {
        const { id: tenantId } = req.params;

        const knex = require('../../../shared/src/db/connection');

        // 1. Get Tenant Basic Info
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        // 2. Count Organizations (Workspaces)
        const orgsCount = await knex('workspaces')
            .where({ tenant_id: tenantId })
            .whereNull('deleted_at')
            .count('id as count')
            .first();

        // 3. Get User Stats
        // Total unique users for this tenant
        const totalUsersResult = await knex('users')
            .join('workspace_users', 'users.id', 'workspace_users.user_id')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspaces.tenant_id', tenantId)
            .whereNull('workspaces.deleted_at')
            .countDistinct('users.id as count')
            .first();

        // Active users: Those who have status 'ACTIVE' in at least one workspace of the tenant
        const activeUsersResult = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspaces.tenant_id', tenantId)
            .where('workspace_users.invitation_status', 'ACTIVE')
            .whereNull('workspaces.deleted_at')
            .countDistinct('workspace_users.user_id as count')
            .first();

        // Pending users: Those who have 'INVITED' status but NO 'ACTIVE' status in any workspace of this tenant
        // (Simplified: count distinct users who are currently 'INVITED' in any workspace of the tenant)
        const pendingUsersResult = await knex('workspace_users')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspaces.tenant_id', tenantId)
            .where('workspace_users.invitation_status', 'INVITED')
            .whereNull('workspaces.deleted_at')
            .whereNotIn('workspace_users.user_id',
                knex('workspace_users')
                    .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
                    .where('workspaces.tenant_id', tenantId)
                    .where('workspace_users.invitation_status', 'ACTIVE')
                    .select('workspace_users.user_id')
            )
            .countDistinct('workspace_users.user_id as count')
            .first();

        // Admin users (SUPER_ADMIN, TENANT_ADMIN, WORKSPACE_ADMIN)
        const adminUsersResult = await knex('users')
            .join('workspace_users', 'users.id', 'workspace_users.user_id')
            .join('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .where('workspaces.tenant_id', tenantId)
            .whereNull('workspaces.deleted_at')
            .whereIn('workspace_users.role', ['SUPER_ADMIN', 'TENANT_ADMIN', 'WORKSPACE_ADMIN'])
            .countDistinct('users.id as count')
            .first();

        const stats = {
            tenantInfo: {
                name: tenant.legal_name,
                primaryContact: tenant.contact_email || 'Not Set',
                organizationsCount: parseInt(orgsCount.count || 0),
                plan: tenant.subscription_plan || 'STARTER'
            },
            userManagement: {
                totalUsers: parseInt(totalUsersResult.count || 0),
                activeUsers: parseInt(activeUsersResult.count || 0),
                pendingUsers: parseInt(pendingUsersResult.count || 0),
                adminUsers: parseInt(adminUsersResult.count || 0),
                organizationUsers: Math.max(0, parseInt(totalUsersResult.count || 0) - parseInt(adminUsersResult.count || 0)),
                ssoIntegration: 'Available'
            }
        };

        return successResponse(res, stats, 'Tenant stats retrieved successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const resendInvite = async (req, res) => {
    try {
        const { id, userId } = req.params;
        const knex = require("../../../shared/src/db/connection");
        const crypto = require("crypto");
        const { publishMessage } = require("../../../shared/src/nats/client");

        const user = await knex("users").where("id", userId).first();
        if (!user) return errorResponse(res, "User not found", 404);

        const workspaces = await knex("workspace_users")
            .join("workspaces", "workspace_users.workspace_id", "workspaces.id")
            .where("workspace_users.user_id", user.id)
            .where("workspaces.tenant_id", id)
            .select("workspaces.name", "workspaces.id");

        if (workspaces.length === 0) return errorResponse(res, "No pending invitations", 400);

        const invitationToken = crypto.randomUUID();
        const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await knex("users").where("id", user.id).update({
            invitation_token: invitationToken,
            invitation_expires_at: invitationExpiresAt,
            updated_at: new Date()
        });

        const tenant = await knex("tenants").where("id", id).first();
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const inviteLink = `${frontendUrl}/accept-invite?token=${invitationToken}`;

        publishMessage("USER_INVITED", {
            email: user.email,
            user_name: user.full_name,
            inviter_name: req.user ? (req.user.name || "Admin") : "Admin",
            tenant_name: tenant.legal_name,
            org_names: workspaces.map(w => w.name),
            invite_link: inviteLink,
            is_existing_user: user.is_active
        });

        return successResponse(res, { invitation_token: invitationToken }, "Invitation resent");
    } catch (error) { return errorResponse(res, error); }
};

const updateUserRole = async (req, res) => {
    try {
        const { id, userId } = req.params;
        const { role, workspace_id } = req.body;
        const knex = require("../../../shared/src/db/connection");

        if (!role || !workspace_id) return errorResponse(res, "Role and workspace_id required", 400);

        let workspaceRole = "VIEWER";
        switch (role) {
            case "Super Admin": workspaceRole = "SUPER_ADMIN"; break;
            case "Tenant Admin": workspaceRole = "TENANT_ADMIN"; break;
            case "Organization Admin": workspaceRole = "WORKSPACE_ADMIN"; break;
            case "Accountant": workspaceRole = "ACCOUNTANT"; break;
            case "Viewer": workspaceRole = "VIEWER"; break;
            case "Auditor": workspaceRole = "AUDITOR"; break;
            case "GST Practitioner": workspaceRole = "GST_PRACTITIONER"; break;
            default: workspaceRole = "VIEWER";
        }

        const updated = await knex("workspace_users")
            .where({ user_id: userId, workspace_id: workspace_id })
            .update({ role: workspaceRole }); // removed updated_at: new Date() as column doesn't exist

        if (updated) {
            try {
                // Keycloak Sync for updated role
                const user = await knex("users").where({ id: userId }).first();
                const workspace = await knex("workspaces").where({ id: workspace_id }).first();
                const tenant = await knex("tenants").where({ id: id }).first();

                if (user && workspace && tenant && user.auth_provider_id && tenant.metadata?.keycloak_groups?.tenant_group_id) {
                    const tenantGroupId = tenant.metadata.keycloak_groups.tenant_group_id;
                    const orgGroup = await keycloakService.getSubgroupByName(tenantGroupId, workspace.workspace_code);

                    if (orgGroup) {
                        // We need to fetch user's current groups and remove them from other role groups under this org
                        const userGroups = await keycloakService.getUserGroups(user.auth_provider_id);
                        if (userGroups) {
                            for (const group of userGroups) {
                                // If the group is a child of the orgGroup, it's a role group. Remove user from it.
                                if (group.path.includes(orgGroup.path) && group.id !== orgGroup.id) {
                                    await keycloakService.removeUserFromGroup(user.auth_provider_id, group.id);
                                }
                            }
                        }

                        // Now add to the new role group
                        let roleGroup = await keycloakService.getSubgroupByName(orgGroup.id, role);
                        if (!roleGroup) {
                            roleGroup = await keycloakService.createSubgroup(orgGroup.id, role, {
                                type: 'ROLE',
                                organization: workspace.workspace_code
                            });
                        }
                        if (roleGroup) {
                            await keycloakService.addUserToGroup(user.auth_provider_id, roleGroup.id);
                        }
                    }
                }
            } catch (kcErr) {
                console.warn(`Keycloak role update failed for user ${userId}:`, kcErr.message);
            }
        }

        if (!updated) return errorResponse(res, "User mapping not found", 404);
        return successResponse(res, null, "User role updated");
    } catch (error) { return errorResponse(res, error); }
};

const deleteUserRole = async (req, res) => {
    try {
        const { id, userId } = req.params;
        const { workspace_id } = req.query;
        const knex = require("../../../shared/src/db/connection");
        if (!workspace_id) return errorResponse(res, "workspace_id required", 400);

        const deleted = await knex("workspace_users")
            .where({ user_id: userId, workspace_id: workspace_id })
            .delete();

        if (deleted) {
            try {
                // Keycloak Sync: Remove user from organization groups
                const user = await knex("users").where({ id: userId }).first();
                const workspace = await knex("workspaces").where({ id: workspace_id }).first();
                const tenant = await knex("tenants").where({ id: id }).first();

                if (user && workspace && tenant && user.auth_provider_id && tenant.metadata?.keycloak_groups?.tenant_group_id) {
                    const tenantGroupId = tenant.metadata.keycloak_groups.tenant_group_id;
                    const orgGroup = await keycloakService.getSubgroupByName(tenantGroupId, workspace.workspace_code);

                    if (orgGroup) {
                        // Fetch user's current groups and remove them from all groups under this org
                        const userGroups = await keycloakService.getUserGroups(user.auth_provider_id);
                        if (userGroups) {
                            for (const group of userGroups) {
                                // If the group is the orgGroup or a child of the orgGroup, remove user from it
                                if (group.path.includes(orgGroup.path)) {
                                    await keycloakService.removeUserFromGroup(user.auth_provider_id, group.id);
                                }
                            }
                        }
                    }
                }
            } catch (kcErr) {
                console.warn(`Keycloak delete role failed for user ${userId}:`, kcErr.message);
            }
        }

        if (!deleted) return errorResponse(res, "User mapping not found", 404);
        return successResponse(res, null, "User removed from organization");
    } catch (error) { return errorResponse(res, error); }
};

const updateUser = async (req, res) => {
    try {
        const { id: tenantId, userId } = req.params;
        const { full_name, phone_number, role, organization_ids } = req.body;
        const knex = require("../../../shared/src/db/connection");

        // 1. Update User Profile
        await User.update(userId, {
            full_name,
            phone: phone_number,
            designation: role,
            updated_at: new Date()
        });

        // 2. Update Workspace Access
        if (organization_ids && Array.isArray(organization_ids)) {
            let workspaceRole = "VIEWER";
            switch (role) {
                case "Super Admin": workspaceRole = "SUPER_ADMIN"; break;
                case "Tenant Admin": workspaceRole = "TENANT_ADMIN"; break;
                case "Organization Admin": workspaceRole = "WORKSPACE_ADMIN"; break;
                case "Accountant": workspaceRole = "ACCOUNTANT"; break;
                case "Viewer": workspaceRole = "VIEWER"; break;
                case "Auditor": workspaceRole = "AUDITOR"; break;
                case "GST Practitioner": workspaceRole = "GST_PRACTITIONER"; break;
                default: workspaceRole = "VIEWER";
            }

            // Step A: Get current organization access for this user in this tenant
            const currentOrgs = await knex("workspace_users")
                .join("workspaces", "workspace_users.workspace_id", "workspaces.id")
                .where({ "workspace_users.user_id": userId, "workspaces.tenant_id": tenantId })
                .select("workspace_users.workspace_id");

            const currentOrgIds = currentOrgs.map(o => o.workspace_id);

            // Step B: Organizations to remove
            const orgsToRemove = currentOrgIds.filter(oid => !organization_ids.includes(oid));
            if (orgsToRemove.length > 0) {
                await knex("workspace_users")
                    .where({ user_id: userId })
                    .whereIn("workspace_id", orgsToRemove)
                    .delete();
            }

            // Step C: Organizations to add or update
            if (organization_ids.length > 0) {
                const workspaceUsers = organization_ids.map(orgId => ({
                    id: crypto.randomUUID(),
                    workspace_id: orgId,
                    user_id: userId,
                    role: workspaceRole,
                    joined_at: new Date()
                }));

                await knex("workspace_users")
                    .insert(workspaceUsers)
                    .onConflict(['workspace_id', 'user_id'])
                    .merge(['role']);
            }
        }

        return successResponse(res, null, "User updated successfully");
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateRolePermissions = async (req, res) => {
    try {
        const { id } = req.params; // tenantId
        const { matrix } = req.body; // { ROLE: { perm: true, ... }, ... }

        if (!matrix) {
            return errorResponse(res, 'Permissions matrix is required', 400);
        }

        // 1. Save to Tenant Metadata as the Global Policy
        const tenant = await knex('tenants').where({ id }).first();
        if (!tenant) {
            return errorResponse(res, 'Tenant not found', 404);
        }

        const metadata = tenant.metadata || {};
        metadata.role_policies = matrix;

        await knex('tenants')
            .where({ id })
            .update({
                metadata: JSON.stringify(metadata),
                updated_at: new Date()
            });

        // 2. Propagate to all existing workspaces/users for this tenant
        const workspaces = await knex('workspaces').where({ tenant_id: id }).select('id');
        const workspaceIds = workspaces.map(w => w.id);

        if (workspaceIds.length > 0) {
            // Perform updates for each role in the matrix
            for (const [role, permissions] of Object.entries(matrix)) {
                await knex('workspace_users')
                    .whereIn('workspace_id', workspaceIds)
                    .andWhere({ role: role })
                    .update({
                        permissions: JSON.stringify(permissions)
                    });
            }
        }

        return successResponse(res, null, 'Role permissions synchronized globally for this tenant.');
    } catch (error) {
        console.error('Update Role Permissions Error:', error);
        return errorResponse(res, error);
    }
};

const getRolePermissions = async (req, res) => {
    try {
        const { id } = req.params; // tenantId

        // 1. Try to get from Tenant Metadata (Source of Truth)
        const tenant = await knex('tenants').where({ id }).select('metadata').first();
        if (tenant && tenant.metadata && tenant.metadata.role_policies) {
            return successResponse(res, tenant.metadata.role_policies);
        }

        // 2. Fallback: If not in metadata, try to extract from existing workspace_users
        const workspaces = await knex('workspaces').where({ tenant_id: id }).select('id');
        const workspaceIds = workspaces.map(w => w.id);

        if (workspaceIds.length === 0) {
            return successResponse(res, {}, 'No policy found');
        }

        const records = await knex('workspace_users')
            .whereIn('workspace_id', workspaceIds)
            .whereNotNull('permissions')
            .select('role', 'permissions')
            .distinctOn('role');

        const matrix = {};
        records.forEach(r => {
            matrix[r.role] = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
        });

        return successResponse(res, matrix);
    } catch (error) {
        console.error('Get Role Permissions Error:', error);
        return errorResponse(res, error);
    }
};

const listTenantWorkspaces = async (req, res) => {
    try {
        const { id } = req.params;
        const workspaces = await knex('workspaces')
            .select(
                'workspaces.*',
                knex.raw('CAST(COUNT(DISTINCT workspace_users.user_id) AS INTEGER) as user_count')
            )
            .leftJoin('workspace_users', 'workspaces.id', 'workspace_users.workspace_id')
            .where('workspaces.tenant_id', id)
            .whereNull('workspaces.deleted_at')
            .groupBy('workspaces.id')
            .orderBy('workspaces.created_at', 'desc');

        return successResponse(res, workspaces);
    } catch (error) {
        console.error('List Tenant Workspaces Error:', error);
        return errorResponse(res, error);
    }
};

const getGlobalStats = async (req, res) => {
    try {
        const totalTenantsResult = await knex('tenants').count('id as count').first();
        const totalWorkspacesResult = await knex('workspaces').count('id as count').first();
        const totalUsersResult = await knex('users')
            .whereNot('email', 'superadmin.dev@gmail.com')
            .count('id as count')
            .first();

        return successResponse(res, {
            totalTenants: parseInt(totalTenantsResult.count) || 0,
            totalWorkspaces: parseInt(totalWorkspacesResult.count) || 0,
            totalUsers: parseInt(totalUsersResult.count) || 0
        });
    } catch (error) {
        console.error('Get Global Stats Error:', error);
        return errorResponse(res, error);
    }
};

const logUserActivity = async (req, res) => {
    try {
        const {
            userId,
            tenantId,
            workspaceId,
            actionType,
            entityType,
            entityId,
            details
        } = req.body;

        await logActivity({
            userId: userId || (req.user ? (req.user.db_id || req.user.id) : null),
            tenantId: tenantId || (req.user ? req.user.tenantId : null),
            workspaceId: workspaceId || (req.user ? req.user.workspaceId : null),
            actionType,
            entityType,
            entityId,
            details,
            req
        });

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in logUserActivity controller:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
};

const listAllUsers = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');

        // ALL-SYSTEM LIST (Every user in the database, excluding superadmin)
        const users = await knex('users')
            .select(
                'users.id',
                'users.tenant_id',
                'users.full_name',
                'users.email',
                'users.phone',
                'users.designation',
                'users.is_active',
                'users.last_login_at',
                'users.created_at',
                // Aggregate status: Active if ALREADY accepted ANY invite, else Pending
                knex.raw("CASE WHEN bool_or(workspace_users.invitation_status = 'ACTIVE') THEN 'ACTIVE' ELSE 'INVITED' END as invitation_status"),
                knex.raw('CAST(COUNT(DISTINCT workspaces.id) AS INTEGER) as organization_count'),
                knex.raw('MAX(workspace_users.role) as role'),
                knex.raw('COALESCE(array_agg(DISTINCT workspaces.name) FILTER (WHERE workspaces.name IS NOT NULL), \'{}\') as organization_names')
            )
            .leftJoin('workspace_users', 'users.id', 'workspace_users.user_id')
            .leftJoin('workspaces', 'workspace_users.workspace_id', 'workspaces.id')
            .whereNot('users.email', 'superadmin.dev@gmail.com')
            .groupBy('users.id', 'users.tenant_id', 'users.full_name', 'users.email', 'users.phone', 'users.designation', 'users.is_active', 'users.last_login_at', 'users.created_at');

        // Map internal status to 'Active'/ 'Pending' for frontend
        const formattedUsers = users.map(u => ({
            ...u,
            status: u.invitation_status === 'ACTIVE' ? 'Active' : (u.invitation_status === 'INVITED' ? 'Pending' : 'Inactive')
        }));

        return successResponse(res, formattedUsers, 'All system users retrieved successfully');
    } catch (error) {
        console.error('ListAllUsers Error:', error);
        return errorResponse(res, error);
    }
};

module.exports = {
    createTenant,
    getTenant,
    listTenants,
    updateTenant,
    deleteTenant,
    registerTenant,
    provisionUser,
    listTenantUsers,
    getTenantActivities,
    getTenantStats,
    resendInvite,
    updateUserRole,
    deleteUserRole,
    updateUser,
    updateRolePermissions,
    getRolePermissions,
    listTenantWorkspaces,
    getGlobalStats,
    listAllUsers,
    logUserActivity,
    getAuditLogs: async (req, res) => {
        try {
            const { limit = 50, offset = 0, search } = req.query;
            const database = require('../../../shared/src/db/connection');

            let query = database('audit_log')
                .leftJoin('users', function () {
                    this.on(database.raw('users.id::text'), '=', 'audit_log.modified_by')
                })
                .where(function () {
                    this.whereNot('users.email', 'superadmin.dev@gmail.com')
                        .orWhereNull('users.email');
                })
                .select(
                    'audit_log.*',
                    'users.full_name as operator_name',
                    'users.email as operator_email'
                )
                .orderBy('modified_at', 'desc');

            if (search) {
                query = query.where(function () {
                    this.where('audit_log.table_name', 'ilike', `%${search}%`)
                        .orWhere('audit_log.action', 'ilike', `%${search}%`)
                        .orWhere('audit_log.modified_by', 'ilike', `%${search}%`)
                        .orWhere(database.raw('audit_log.record_id::text'), 'ilike', `%${search}%`)
                        .orWhere(database.raw('audit_log.new_value::text'), 'ilike', `%${search}%`)
                        .orWhere(database.raw('audit_log.old_value::text'), 'ilike', `%${search}%`)
                        .orWhere('users.full_name', 'ilike', `%${search}%`)
                        .orWhere('users.email', 'ilike', `%${search}%`);
                });
            }

            const logs = await query
                .limit(parseInt(limit))
                .offset(parseInt(offset));

            // Get total count for pagination if needed
            const totalCount = await database('audit_log').count('id as count').first();

            return successResponse(res, {
                logs,
                total: parseInt(totalCount.count)
            }, 'Audit logs fetched successfully');
        } catch (error) {
            console.error('Error fetching audit logs:', error);
            return errorResponse(res, error);
        }
    }
};
