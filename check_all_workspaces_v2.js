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
        
        console.log('--- Checking Workspaces ---');
        const workspaces = await client.query('SELECT id, name, gstn FROM workspaces');
        console.log('Workspaces:', workspaces.rows);

        console.log('--- Checking ALL Purchase Vouchers for values matching user upload ---');
        // VCHR_NO 1, 71, etc.
        const res = await client.query('SELECT supplier_invoice_no, supplier_gstin, workspace_id FROM purchase_vouchers WHERE supplier_invoice_no IN ($1, $2, $3, $4)', ['1', '71', 'EXP1', 'EXP71']);
        console.log('Records Found:', res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
