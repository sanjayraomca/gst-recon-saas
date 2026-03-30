const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function testRawSql() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        const workspaceId = '0bfd15ee-e667-41bb-8c5b-83d6d3fe1e54';
        const runId = 'e4d3685c-cf7c-4835-8e2b-895f32cabedd';
        const exactPeriod = '042025';

        console.log(`Testing RAW SQL for Workspace: ${workspaceId}, Run: ${runId}, Period: ${exactPeriod}`);

        const sql = `
            SELECT 
                COALESCE(tp.period_code, gi.return_period, '000000') as period,
                UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) as category,
                COUNT(pi.id) as books_count,
                COUNT(gi.id) as gstr2b_count
            FROM reconciliation_results rr
            LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
            LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
            LEFT JOIN tax_periods tp ON pi.tax_period_id = tp.id
            WHERE rr.workspace_id = $1
            AND rr.recon_run_id = $2
            AND (
                tp.period_code = $3
                OR gi.return_period = $3
            )
            GROUP BY 1, 2
        `;

        const res = await client.query(sql, [workspaceId, runId, exactPeriod]);
        console.log('Query Result:');
        if (res.rows.length === 0) {
            console.log('NO RESULTS RETURNED!');
            // Check if there are ANY results for this runId and workspaceId
            const checkAny = await client.query('SELECT COUNT(*) FROM reconciliation_results WHERE recon_run_id = $1 AND workspace_id = $2', [runId, workspaceId]);
            console.log(`Total rows in reconciliation_results for this run: ${checkAny.rows[0].count}`);
            
            // Check the source tables for that run
            const checkSources = await client.query(`
                SELECT 
                    rr.id as rr_id,
                    rr.purchase_invoice_id,
                    rr.gstr2b_invoice_id,
                    tp.period_code as pi_period,
                    gi.return_period as gi_period
                FROM reconciliation_results rr
                LEFT JOIN purchase_vouchers pi ON rr.purchase_invoice_id = pi.id
                LEFT JOIN normalized_gstr2b_invoices gi ON rr.gstr2b_invoice_id = gi.id
                LEFT JOIN tax_periods tp ON pi.tax_period_id = tp.id
                WHERE rr.recon_run_id = $1 AND rr.workspace_id = $2
                LIMIT 5
            `, [runId, workspaceId]);
            console.log('Sample rows with periods:');
            console.table(checkSources.rows);
        } else {
            console.table(res.rows);
        }

    } catch (err) {
        console.error('Query Failed:', err);
    } finally {
        await client.end();
    }
}

testRawSql();
