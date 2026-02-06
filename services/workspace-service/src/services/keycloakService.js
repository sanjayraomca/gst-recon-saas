const axios = require('axios');

class KeycloakService {
    constructor() {
        this.baseUrl = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
        this.realm = process.env.KEYCLOAK_REALM || 'gsttool';
        this.clientId = process.env.KEYCLOAK_CLIENT_ID || 'admin-api';
        this.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
        this.adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin';
        this.adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
    }

    async getAdminToken() {
        try {
            const params = new URLSearchParams();
            params.append('client_id', this.clientId);
            params.append('client_secret', this.clientSecret);
            params.append('grant_type', 'client_credentials');

            const response = await axios.post(
                `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
                params
            );
            return response.data.access_token;
        } catch (error) {
            console.error('Keycloak Admin Token Error:', error.response?.data || error.message);
            throw new Error('Failed to get admin token');
        }
    }

    // ============================================
    // GROUP MANAGEMENT METHODS
    // ============================================

    async createGroup(groupName, attributes = {}) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups`;

            // Keycloak expects attributes as key-value pairs where values are arrays of strings
            const formattedAttributes = {};
            for (const [key, value] of Object.entries(attributes)) {
                formattedAttributes[key] = Array.isArray(value) ? value : [String(value)];
            }

            const groupData = {
                name: groupName,
                attributes: formattedAttributes
            };

            const response = await axios.post(url, groupData, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 201 && response.headers.location) {
                const locationParts = response.headers.location.split('/');
                const groupId = locationParts[locationParts.length - 1];
                console.log(`Created Keycloak group: ${groupName} with ID: ${groupId}`);
                return { id: groupId, name: groupName };
            }

            // Fallback: fetch group by name
            const group = await this.getGroupByName(groupName);
            return group;

        } catch (error) {
            console.error('Keycloak Create Group Error:', error.response?.data || error.message);
            if (error.response?.status === 409) {
                // Return existing group if conflict
                const group = await this.getGroupByName(groupName);
                if (group) return group;
                throw new Error(`Group '${groupName}' already exists in Keycloak`);
            }
            throw new Error('Failed to create group in Keycloak');
        }
    }

    async createSubgroup(parentId, groupName, attributes = {}) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${parentId}/children`;
            console.log("url", url);
            const formattedAttributes = {};
            for (const [key, value] of Object.entries(attributes)) {
                formattedAttributes[key] = Array.isArray(value) ? value : [String(value)];
            }

            const groupData = {
                name: groupName,
                attributes: formattedAttributes
            };

            const response = await axios.post(url, groupData, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 201 && response.headers.location) {
                const locationParts = response.headers.location.split('/');
                const groupId = locationParts[locationParts.length - 1];
                console.log(`Created Keycloak subgroup: ${groupName} under ${parentId} with ID: ${groupId}`);
                return { id: groupId, name: groupName };
            }

            // Fallback: fetch group by name (this search is global, so might return wrong group if names match elsewhere?
            // Actually getGroupByName searches top level? No, 'search' param searches all.
            // But simpler to just return null if location not found.
            return null;

        } catch (error) {
            console.error('Keycloak Create Subgroup Error:', error.response?.data || error.message);
            if (error.response?.status === 409) {
                console.log(`Subgroup ${groupName} likely already exists under ${parentId}`);
                // We can try to find it? for now just error/warn
                return null; // Or throw?
            }
            throw new Error('Failed to create subgroup in Keycloak');
        }
    }

    async getGroupByName(groupName) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups?search=${encodeURIComponent(groupName)}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            if (response.data && response.data.length > 0) {
                const exactMatch = response.data.find(g => g.name === groupName);
                return exactMatch || response.data[0];
            }
            return null;
        } catch (error) {
            console.error('Keycloak Get Group Error:', error.message);
            return null;
        }
    }

    async getGroupById(groupId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${groupId}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return response.data;
        } catch (error) {
            console.error('Keycloak Get Group By ID Error:', error.message);
            return null;
        }
    }
}

module.exports = new KeycloakService();
