const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5432,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function checkCounts() {
    const client = new Client(dbConfig);
    try {
        await client.connect();

        // 1. Get Tax Period for June 2025
        const tpRes = await client.query("SELECT id, period_code FROM tax_periods WHERE month = 6 AND year = 2025");
        console.log("Tax Period June 2025:", tpRes.rows);

        const periodCode = '062025';

        // 2. Count Purchase Vouchers
        const pvRes = await client.query("SELECT count(*) FROM purchase_vouchers WHERE tax_period_id IN (SELECT id FROM tax_periods WHERE month = 6 AND year = 2025)");
        console.log("Purchase Vouchers (June 2025):", pvRes.rows[0].count);

        // 3. Count GSTR-2B Invoices
        const gstrRes = await client.query("SELECT count(*) FROM normalized_gstr2b_invoices WHERE return_period = $1", [periodCode]);
        console.log("GSTR-2B Invoices (June 2025):", gstrRes.rows[0].count);

        // 4. Count Reconciliation Results for the latest run
        const latestRun = await client.query("SELECT id, status FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1");
        if (latestRun.rows.length > 0) {
            const runId = latestRun.rows[0].id;
            const resCount = await client.query("SELECT count(*) FROM reconciliation_results WHERE recon_run_id = $1", [runId]);
            console.log(`Latest Recon Run (${runId}) Results Count:`, resCount.rows[0].count);
        } else {
            console.log("No Reconciliation Runs found.");
        }

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await client.end();
    }
}

checkCounts();
