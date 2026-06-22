const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function run() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- DB Record Counts Post-Sync ---');
        const purchaseCount = await client.query('SELECT COUNT(*) FROM purchase_vouchers');
        const salesCount = await client.query('SELECT COUNT(*) FROM sales_invoices');
        
        console.log(`Purchase Vouchers count: ${purchaseCount.rows[0].count}`);
        console.log(`Sales Invoices count: ${salesCount.rows[0].count}`);
        
        console.log('\n--- Sample Sales Vouchers ---');
        const sampleSales = await client.query('SELECT invoice_number, invoice_type, book_type, total_invoice_value FROM sales_invoices');
        console.table(sampleSales.rows);

        console.log('\n--- Sample Purchase Vouchers ---');
        const samplePurchase = await client.query('SELECT supplier_invoice_no, voucher_type, book_type, net_amount FROM purchase_vouchers');
        console.table(samplePurchase.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
