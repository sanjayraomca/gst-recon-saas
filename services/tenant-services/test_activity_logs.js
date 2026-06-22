const axios = require('axios');

const baseURL = 'http://localhost:3001';

async function loginWithFallback() {
    try {
        console.log('Trying with asif@123...');
        const res = await axios.post(`${baseURL}/auth/login`, {
            email: 'superadmin.dev@gmail.com',
            password: 'asif@123'
        });
        return { token: res.data.data.access_token, tenantId: res.data.data.tenant_id, pw: 'asif@123' };
    } catch (e) {
        console.log('Failed with asif@123. Trying with newpassword123...');
        const res = await axios.post(`${baseURL}/auth/login`, {
            email: 'superadmin.dev@gmail.com',
            password: 'newpassword123'
        });
        return { token: res.data.data.access_token, tenantId: res.data.data.tenant_id, pw: 'newpassword123' };
    }
}

async function testLogs() {
    try {
        const { token, tenantId, pw } = await loginWithFallback();
        console.log('Login successful. Password state is:', pw);

        console.log('\n2. Updating User Profile...');
        const profileUpdateRes = await axios.put(`${baseURL}/auth/profile`, {
            full_name: 'Super Admin Log Test'
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Profile update response:', profileUpdateRes.data.message);

        console.log('\n3. Changing password back and forth to trigger logs...');
        const otherPw = pw === 'asif@123' ? 'newpassword123' : 'asif@123';

        await axios.put(`${baseURL}/auth/change-password`, {
            currentPassword: pw,
            newPassword: otherPw
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Password changed successfully.');

        // Login again to get new token
        const res2 = await axios.post(`${baseURL}/auth/login`, {
            email: 'superadmin.dev@gmail.com',
            password: otherPw
        });
        const token2 = res2.data.data.access_token;

        await axios.put(`${baseURL}/auth/change-password`, {
            currentPassword: otherPw,
            newPassword: pw
        }, {
            headers: { Authorization: `Bearer ${token2}` }
        });
        console.log('Password reverted successfully.');

        console.log('\nAll actions done. Checking database...');
    } catch (error) {
        console.error('\nTest failed:', error.response?.data || error.message);
    }
}

testLogs();
