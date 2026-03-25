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
        console.log('--- Purchase Voucher Check ---');

        const res = await client.query('SELECT supplier_invoice_no, supplier_invoice_date, supplier_gstin, workspace_id FROM purchase_vouchers WHERE supplier_invoice_no IN ($1, $2, $3, $4)', ['1', '71', 'EXP1', 'EXP71']);
        console.log('Matching Records Found:', res.rows);

        const total = await client.query('SELECT count(*) FROM purchase_vouchers');
        console.log('Total Records in purchase_vouchers:', total.rows[0].count);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
