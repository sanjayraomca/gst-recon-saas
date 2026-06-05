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

        console.log('--- Columns in purchase_items ---');
        const itemsCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'purchase_items'");
        console.log(itemsCols.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));

        console.log('\n--- Sample Purchase Items Records (showing row_total, invoice_amount) ---');
        const sampleRes = await client.query("SELECT id, row_total, invoice_amount FROM purchase_items LIMIT 5");
        console.log(sampleRes.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkColumns();
