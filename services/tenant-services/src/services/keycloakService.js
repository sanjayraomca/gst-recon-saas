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

    async login(username, password) {
        try {
            const params = new URLSearchParams();
            params.append('client_id', this.clientId);
            params.append('grant_type', 'password');
            params.append('username', username);
            params.append('password', password);
            if (this.clientSecret) {
                params.append('client_secret', this.clientSecret);
            }

            const response = await axios.post(
                `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
                params
            );

            return response.data; // { access_token, refresh_token, ... }
        } catch (error) {
            console.error('Keycloak Login Error:', error.response?.data || error.message);
            throw new Error('Authentication failed');
        }
    }

    async refreshToken(refreshToken) {
        try {
            const params = new URLSearchParams();
            params.append('client_id', this.clientId);
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', refreshToken);
            if (this.clientSecret) {
                params.append('client_secret', this.clientSecret);
            }

            const response = await axios.post(
                `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
                params
            );

            return response.data;
        } catch (error) {
            console.error('Keycloak Refresh Error:', error.response?.data || error.message);
            throw new Error('Token refresh failed');
        }
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

    async createUser(userData) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users`;

            const keycloakUser = {
                username: userData.email,
                email: userData.email,
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                enabled: true,
                emailVerified: true, // Assuming auto-verified for now
                credentials: [{
                    type: 'password',
                    value: userData.password,
                    temporary: false
                }]
            };

            const response = await axios.post(url, keycloakUser, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            // Keycloak returns 201 Created with Location header containing ID
            if (response.status === 201) {
                const locationParts = response.headers.location.split('/');
                const userId = locationParts[locationParts.length - 1];
                return userId;
            }

            // If we can't get ID from header, try to fetch user by email
            const user = await this.getUserByEmail(userData.email);
            return user ? user.id : null;

        } catch (error) {
            console.error('Keycloak Create User Error:', error.response?.data || error.message);
            if (error.response?.status === 409) {
                throw new Error('User already exists in Keycloak');
            }
            throw new Error('Failed to create user in Keycloak');
        }
    }

    async getUserByEmail(email) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users?email=${email}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            if (response.data && response.data.length > 0) {
                return response.data[0];
            }
            return null;
        } catch (error) {
            console.error('Keycloak Get User Error:', error.message);
            return null;
        }
    }

    async updateUser(userId, userData) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`;

            // Map local fields to Keycloak fields
            const keycloakUpdate = {};
            if (userData.full_name) {
                const parts = userData.full_name.split(' ');
                keycloakUpdate.firstName = parts[0];
                keycloakUpdate.lastName = parts.slice(1).join(' ') || '';
            }
            // Add other fields if necessary (email, etc.)

            if (Object.keys(keycloakUpdate).length > 0) {
                await axios.put(url, keycloakUpdate, {
                    headers: {
                        'Authorization': `Bearer ${adminToken}`,
                        'Content-Type': 'application/json'
                    }
                });
            }
            return true;
        } catch (error) {
            console.error('Keycloak Update User Error:', error.response?.data || error.message);
            // Don't throw logic error, just log it as per requirement "if keycloak is not then only database"
            return false;
        }
    }

    async resetPassword(userId, newPassword) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`;

            await axios.put(url, {
                type: 'password',
                value: newPassword,
                temporary: false
            }, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return true;
        } catch (error) {
            console.error('Keycloak Reset Password Error:', error.response?.data || error.message);
            throw new Error('Failed to reset password in Keycloak');
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

            // Keycloak returns 201 Created with Location header containing group ID
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
                throw new Error(`Group '${groupName}' already exists in Keycloak`);
            }
            throw new Error('Failed to create group in Keycloak');
        }
    }

    async createSubgroup(parentId, groupName, attributes = {}) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${parentId}/children`;

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

            return null;

        } catch (error) {
            console.error('Keycloak Create Subgroup Error:', error.response?.data || error.message);
            if (error.response?.status === 409) {
                console.log(`Subgroup ${groupName} likely already exists under ${parentId}`);
                return null;
            }
            throw new Error('Failed to create subgroup in Keycloak');
        }
    }



    async getSubgroupByName(parentId, subgroupName) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${parentId}/children`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            if (response.data && Array.isArray(response.data)) {
                return response.data.find(g => g.name === subgroupName) || null;
            }
            return null;

        } catch (error) {
            console.error(`Keycloak Get Subgroup Error (${subgroupName}):`, error.message);
            return null;
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
                // Find exact match
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

    async getGroupMembers(groupId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${groupId}/members`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return response.data; // Array of user objects
        } catch (error) {
            console.error('Keycloak Get Group Members Error:', error.message);
            return [];
        }
    }

    async listGroups() {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return response.data || [];
        } catch (error) {
            console.error('Keycloak List Groups Error:', error.message);
            return [];
        }
    }

    async addUserToGroup(userId, groupId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`;

            await axios.put(url, {}, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return true;
        } catch (error) {
            console.error('Keycloak Add User to Group Error:', error.response?.data || error.message);
            return false;
        }
    }

    async removeUserFromGroup(userId, groupId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`;

            await axios.delete(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return true;
        } catch (error) {
            console.error('Keycloak Remove User from Group Error:', error.response?.data || error.message);
            return false;
        }
    }

    async getUserGroups(userId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/groups`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return response.data || [];
        } catch (error) {
            console.error('Keycloak Get User Groups Error:', error.message);
            return [];
        }
    }

    async deleteGroup(groupId) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${groupId}`;

            await axios.delete(url, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                }
            });

            return true;
        } catch (error) {
            console.error('Keycloak Delete Group Error:', error.response?.data || error.message);
            return false;
        }
    }

    async updateGroup(groupId, updates) {
        try {
            const adminToken = await this.getAdminToken();
            const url = `${this.baseUrl}/admin/realms/${this.realm}/groups/${groupId}`;

            await axios.put(url, updates, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return true;
        } catch (error) {
            console.error('Keycloak Update Group Error:', error.response?.data || error.message);
            return false;
        }
    }
}

module.exports = new KeycloakService();
