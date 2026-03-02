const axios = require('axios');

const baseURL = 'http://localhost:3001';

async function testProfileAndTenantUpdate() {
    try {
        console.log('1. Logging in...');
        const loginResponse = await axios.post(`${baseURL}/auth/login`, {
            email: 'superadmin.dev@gmail.com',
            password: 'asif@123'
        });

        const token = loginResponse.data.data.access_token;
        const tenantId = loginResponse.data.data.tenant_id;
        console.log('Login successful. Got Token and Tenant ID:', tenantId);

        console.log('\n2. Updating User Profile...');
        const profileUpdateRes = await axios.put(`${baseURL}/auth/profile`, {
            full_name: 'Dev Admin Changed'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Profile update response:', profileUpdateRes.data.message);
        console.log('Updated user data:', profileUpdateRes.data.data.full_name);

        console.log('\n3. Reverting User Profile...');
        await axios.put(`${baseURL}/auth/profile`, {
            full_name: 'Super Admin Dev'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Profile reverted successfully.');

        console.log('\n4. Updating Tenant Details...');
        const tenantUpdateRes = await axios.put(`${baseURL}/tenants/${tenantId}`, {
            legal_name: 'Shiv Shakti Co.'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Tenant update response:', tenantUpdateRes.data.message);
        console.log('Updated tenant data:', tenantUpdateRes.data.data.legal_name);

        console.log('\n5. Reverting Tenant Details...');
        await axios.put(`${baseURL}/tenants/${tenantId}`, {
            legal_name: 'SHIV SHAKTI ENTERPRISE'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Tenant reverted successfully.');

        console.log('\nAll tests passed!');
    } catch (error) {
        console.error('\nTest failed:', error.response?.data || error.message);
        if (error.response?.data?.error) {
            console.error('API Error:', error.response.data.error);
        }
    }
}

testProfileAndTenantUpdate();
