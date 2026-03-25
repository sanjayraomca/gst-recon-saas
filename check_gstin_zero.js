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
        
        console.log('--- Checking for GSTIN 24AALFA9789K1Z0 (Zero) ---');
        const res = await client.query('SELECT supplier_invoice_no, supplier_invoice_date, supplier_gstin FROM purchase_vouchers WHERE supplier_gstin = $1', ['24AALFA9789K1Z0']);
        console.log('Records Found:', res.rows.length);
        if (res.rows.length > 0) {
            console.log('Sample Record:', res.rows[0]);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
