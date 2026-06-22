const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkPeriods() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log('--- Period distribution in reconciliation_results ---');
        const res = await client.query(`
            SELECT 
                COALESCE(tp.period_code, gi.return_period) as period,
                COUNT(*) as count
            FROM reconciliation_results rr
            LEFT JOIN purchase_vouchers pv ON rr.purchase_invoice_id = pv.id
            LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
            LEFT JOIN tax_periods tp ON pv.tax_period_id = tp.id
            GROUP BY period
            ORDER BY period
        `);
        console.table(res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkPeriods();
