const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
    host: 'postgres-main',
    port: 5432,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

const axios = require('axios');

async function run() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        // Fetch workspace settings
        const wsRes = await client.query("SELECT settings FROM workspaces LIMIT 1");
        if (wsRes.rows.length === 0) {
            console.log('No workspaces found.');
            return;
        }
        
        const settings = typeof wsRes.rows[0].settings === 'string' 
            ? JSON.parse(wsRes.rows[0].settings)
            : wsRes.rows[0].settings;
            
        const adeskConfig = settings.adeskCloudConnector || {};
        const cloudUrl = adeskConfig.cloudUrl;
        const apiToken = adeskConfig.apiToken;
        
        console.log('Adesk Cloud URL:', cloudUrl);
        console.log('Adesk API Token:', apiToken ? '***' + apiToken.slice(-5) : 'None');
        
        if (!cloudUrl || !apiToken) {
            console.log('Adesk configuration is missing.');
            return;
        }

        // Let's query Adesk directly with standard dates
        const params = {
            start_date: '2025-04-01',
            end_date: '2026-03-31',
            book_type: 'all',
            page: 1,
            rows: 999999
        };
        
        console.log('Querying Adesk API directly with params:', params);
        const startTime = Date.now();
        const response = await axios.get(cloudUrl, {
            params,
            headers: {
                'X-TIG-API-KEY': apiToken,
                'Accept': 'application/json'
            }
        });
        console.log(`Response received in ${Date.now() - startTime}ms`);
        
        const data = response.data;
        console.log('Adesk success:', data.success);
        console.log('Adesk message:', data.message);
        console.log('Adesk pagination:', data.pagination);
        
        if (data.data && Array.isArray(data.data)) {
            console.log('Total records returned in page 1:', data.data.length);
            
            // Let's analyze record dates
            const dates = data.data.map(r => r.vchr_date).filter(Boolean);
            if (dates.length > 0) {
                dates.sort();
                console.log('Record date range in response:', dates[0], 'to', dates[dates.length - 1]);
            }
        } else {
            console.log('No data array returned:', typeof data.data);
        }

    } catch (e) {
        console.error('Error during run:', e.message);
        if (e.response) {
            console.error('Response details:', e.response.status, e.response.data);
        }
    } finally {
        await client.end();
    }
}
run();
