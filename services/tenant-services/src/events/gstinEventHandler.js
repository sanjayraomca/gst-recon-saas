const keycloakService = require('../services/keycloakService');
const Tenant = require('../models/tenantModel');
const { subscribeToSubject } = require('../../../shared/src/nats/client');

/**
 * Subscribe to GSTIN creation events and create Keycloak groups
 */
const setupGstinEventSubscriber = () => {
    subscribeToSubject('gstin.created', async (data) => {
        try {
            console.log('Received gstin.created event:', data);

            const { gstin, gstin_id, workspace_id, legal_name } = data;

            if (!gstin) {
                console.warn('GSTIN event missing gstin number');
                return;
            }

            // Find tenant associated with this workspace
            const knex = require('../../../shared/src/db/connection');
            const tenantWorkspace = await knex('tenant_workspaces')
                .where({ workspace_id })
                .first();

            if (!tenantWorkspace) {
                console.warn(`No tenant found for workspace: ${workspace_id}`);
                return;
            }

            const tenant = await Tenant.findById(tenantWorkspace.tenant_id);
            if (!tenant) {
                console.warn(`Tenant not found: ${tenantWorkspace.tenant_id}`);
                return;
            }

            // Create Keycloak group for GSTIN
            const groupName = `gstin_${gstin}`;

            try {
                const group = await keycloakService.createGroup(groupName, {
                    gstin: gstin,
                    gstin_id: gstin_id,
                    workspace_id: workspace_id,
                    legal_name: legal_name
                });

                console.log(`Created Keycloak group: ${groupName} with ID: ${group.id}`);

                // Update tenant metadata with GSTIN group mapping
                const metadata = tenant.metadata || {};
                const keycloakGroups = metadata.keycloak_groups || {
                    tenant_group_id: null,
                    gstin_groups: {}
                };

                keycloakGroups.gstin_groups[gstin] = group.id;
                metadata.keycloak_groups = keycloakGroups;

                await Tenant.update(tenant.id, { metadata });

                console.log(`Updated tenant ${tenant.tenant_code} with GSTIN group mapping`);

            } catch (kcError) {
                console.error(`Failed to create Keycloak group for GSTIN ${gstin}:`, kcError.message);
            }

        } catch (error) {
            console.error('Error processing gstin.created event:', error);
        }
    });

    console.log('GSTIN event subscriber initialized');
};

module.exports = {
    setupGstinEventSubscriber
};
