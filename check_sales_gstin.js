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
        
        console.log('--- Checking Sales Invoices for customer_gstin 24AALFA9789K1ZO ---');
        const res = await client.query('SELECT invoice_number, invoice_date, customer_gstin FROM sales_invoices WHERE customer_gstin = $1', ['24AALFA9789K1ZO']);
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
