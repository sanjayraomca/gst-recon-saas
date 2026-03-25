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
        
        console.log('--- Checking for GSTIN 24AALFA9789K1ZO ---');
        const res = await client.query('SELECT supplier_invoice_no, supplier_invoice_date, supplier_gstin FROM purchase_vouchers WHERE supplier_gstin = $1', ['24AALFA9789K1ZO']);
        console.log('Records Found:', res.rows);

        if (res.rows.length === 0) {
            console.log('No records found for this GSTIN. Checking if it matches ORG_GSTIN in some other table?');
            // Maybe it's in sales?
            const sales = await client.query('SELECT invoice_number, customer_gstin FROM sales_invoices WHERE customer_gstin = $1 LIMIT 5', ['24AALFA9789K1ZO']);
            console.log('Sales Records Found:', sales.rows);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
