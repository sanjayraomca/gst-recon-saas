const axiosLib = require('../services/workspace-service/node_modules/axios');
const axios = axiosLib.default || axiosLib;
const jwt = require('../services/workspace-service/node_modules/jsonwebtoken');

async function test() {
    try {
        const payload = {
            sub: 'rd38uR3Il8bmRl43AQ9s3utj',
            email: 'sarani@gmail.com',
            exp: Math.floor(Date.now() / 1000) + 3600
        };
        const token = jwt.sign(payload, 'change-this-secret-in-production');

        const workspaceId = '0e87ab31-a7aa-4252-b2c9-ace3a65bc3bb';
        console.log('Hitting /book-data/deleted for workspace:', workspaceId);

        const response = await axios.get('http://localhost:3002/book-data/deleted', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-workspace-id': workspaceId
            }
        });

        console.log('Response status:', response.status);
        console.log('Response body:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('API call failed:', err.response ? {
            status: err.response.status,
            data: err.response.data
        } : err.message);
    }
}
test();
