const axios = require('axios');

const createOrgWithLocation = async () => {
    try {
        const response = await axios.post('http://localhost:3002/workspaces', {
            code: '27AABCU9603R1Q' + Math.floor(Math.random() * 10),
            name: 'Test Location Org ' + Date.now(),
            filing_frequency: 'quarterly',
            industry_type: 'pvt',
            tenant_id: '6e425ed9-d659-49c5-8182-49e25aafd304',
            city: 'Pune',
            state: 'Maharashtra'
        });
        console.log('Response:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};
// createOrgWithLocation(); 
// Implementation note: I cannot run this because axios is missing. 
// I will use curl instead.
