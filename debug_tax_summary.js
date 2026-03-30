const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

const workspaceId = '0bfd15ee-e667-41bb-8c5b-83d6d3fe1e54';
const months = ['042025', '052025', '062025', '072025', '082025', '092025', '102025', '112025', '122025', '012026', '022026', '032026'];

async function debugTaxSummary() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        console.log(`--- Checking results for workspace ${workspaceId} and FY 2025-26 ---`);
        const res = await client.query(`
            SELECT 
                COALESCE(tp.period_code, gi.return_period) as period,
                COUNT(*) as count
            FROM reconciliation_results rr
            LEFT JOIN purchase_vouchers pv ON rr.purchase_invoice_id = pv.id
            LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
            LEFT JOIN tax_periods tp ON pv.tax_period_id = tp.id
            WHERE rr.workspace_id = $1
            AND COALESCE(tp.period_code, gi.return_period) = ANY($2)
            GROUP BY period
        `, [workspaceId, months]);
        
        console.log('Results breakdown:');
        console.table(res.rows);

        if (res.rows.length === 0) {
            console.log('No results found for this workspace and period.');
            // Check if there are ANY results for this workspace
            const anyRes = await client.query('SELECT COUNT(*) FROM reconciliation_results WHERE workspace_id = $1', [workspaceId]);
            console.log(`Total results for this workspace (any period): ${anyRes.rows[0].count}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

debugTaxSummary();
