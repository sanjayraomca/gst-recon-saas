const axios = require('axios');

async function testChangePassword() {
    const baseURL = 'http://localhost:3001';

    try {
        console.log('1. Logging in...');
        const loginResponse = await axios.post(`${baseURL}/auth/login`, {
            email: 'superadmin.dev@gmail.com',
            password: 'superadmin@123' // Initial password
        });

        const token = loginResponse.data.data.access_token;
        console.log('Login successful. Got Token.');

        console.log('2. Trying to change password with incorrect current password...');
        try {
            await axios.put(`${baseURL}/auth/change-password`, {
                currentPassword: 'wrongpassword',
                newPassword: 'newpassword123'
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.error('FAIL: Should have rejected the incorrect current password');
        } catch (err) {
            console.log('SUCCESS: Rejected incorrect current password as expected:', err.response?.data?.error || err.message);
        }

        console.log('3. Trying to change password with correct current password...');
        try {
            const changeRes = await axios.put(`${baseURL}/auth/change-password`, {
                currentPassword: 'superadmin@123',
                newPassword: 'newsecret@123'
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('SUCCESS: Password changed:', changeRes.data.message);
        } catch (err) {
            console.error('FAIL: Failed to change password:', err.response?.data?.error || err.message);
            return;
        }

        console.log('4. Verifying new password by logging in again...');
        try {
            await axios.post(`${baseURL}/auth/login`, {
                email: 'superadmin.dev@gmail.com',
                password: 'newsecret@123'
            });
            console.log('SUCCESS: Logged in with new password!');
        } catch (err) {
            console.error('FAIL: Could not login with new password:', err.response?.data?.error || err.message);
        }

        console.log('5. Reverting password back to original...');
        try {
            // we need a new token for reverting
            const loginResponse2 = await axios.post(`${baseURL}/auth/login`, {
                email: 'superadmin.dev@gmail.com',
                password: 'newsecret@123'
            });
            const token2 = loginResponse2.data.data.access_token;

            await axios.put(`${baseURL}/auth/change-password`, {
                currentPassword: 'newsecret@123',
                newPassword: 'superadmin@123'
            }, {
                headers: { Authorization: `Bearer ${token2}` }
            });
            console.log('SUCCESS: Reverted password back to original.');
        } catch (err) {
            console.error('FAIL: Failed to revert password:', err.response?.data?.error || err.message);
        }

    } catch (e) {
        console.error('Test script error:', e.response?.data || e.message);
    }
}

testChangePassword();
