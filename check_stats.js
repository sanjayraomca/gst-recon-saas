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
        
        console.log('--- GSTR Counts by Period ---');
        const gstrRes = await client.query("SELECT return_period, count(*) FROM normalized_gstr2b_invoices GROUP BY return_period ORDER BY return_period DESC");
        console.log(gstrRes.rows);

        console.log('--- Sales Data Counts ---');
        const salesRes = await client.query("SELECT count(*) FROM sales_invoices");
        console.log(salesRes.rows);

        console.log('--- Purchase Data Counts ---');
        const purchaseRes = await client.query("SELECT count(*) FROM purchase_vouchers");
        console.log(purchaseRes.rows);

        if (salesRes.rows[0].count > 0) {
            console.log('--- Sales Data Samples ---');
            const sampleRes = await client.query("SELECT id, workspace_id, invoice_number, invoice_date, customer_gstin FROM sales_invoices LIMIT 5");
            console.log(sampleRes.rows);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
