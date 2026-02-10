const axios = require('axios');

const createOrg = async () => {
    try {
        const response = await axios.post('http://localhost:3002/workspaces', {
            code: '27AABCU9603R1Z' + Math.floor(Math.random() * 10), // Randomize slightly
            name: 'Test Quarterly Org ' + Date.now(),
            filing_frequency: 'quarterly',
            industry_type: 'pvt',
            tenant_id: '6e425ed9-d659-49c5-8182-49e25aafd304' // Use existing tenant ID
        });
        console.log('Response:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

createOrg();
