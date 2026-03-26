const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkColumns() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Columns in sales_invoices ---');
        const salesCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sales_invoices'");
        console.log(salesCols.rows.map(r => r.column_name).join(', '));

        console.log('\n--- Columns in purchase_vouchers ---');
        const purchaseCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'purchase_vouchers'");
        console.log(purchaseCols.rows.map(r => r.column_name).join(', '));

        console.log('\n--- Sample Purchase Record ---');
        const sampleRes = await client.query("SELECT * FROM purchase_vouchers LIMIT 1");
        console.log(sampleRes.rows[0]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkColumns();
