const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function check() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Checking GSTR2B Records for 122025 ---');
        const res = await client.query("SELECT supplier_gstin, document_number_clean, document_date, source_section FROM normalized_gstr2b_invoices WHERE return_period = '122025' LIMIT 5");
        console.log('Sample Records:', res.rows);

        const counts = await client.query("SELECT source_section, count(*) FROM normalized_gstr2b_invoices WHERE return_period = '122025' GROUP BY source_section");
        console.log('Counts by Section:', counts.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
