const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkGstr() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Checking ALL GSTR2B Records ---');
        const res = await client.query("SELECT supplier_gstin, document_number_clean, document_date, return_period FROM normalized_gstr2b_invoices LIMIT 10");
        console.log('GSTR Samples:', res.rows.map(r => ({
            ...r,
            formatted_date: r.document_date.toISOString()
        })));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkGstr();
