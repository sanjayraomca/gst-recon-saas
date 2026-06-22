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

        // 1. Get resolved workspace and tenant IDs
        const ws = await client.query("SELECT id, tenant_id FROM workspaces LIMIT 1");
        const workspaceId = ws.rows[0].id;
        const tenantId = ws.rows[0].tenant_id;

        // 2. Ensure tax period exists
        const tpRes = await client.query("SELECT id FROM tax_periods LIMIT 1");
        const taxPeriodId = tpRes.rows[0].id;

        console.log(`Resolved Workspace: ${workspaceId}, Tenant: ${tenantId}, TaxPeriod: ${taxPeriodId}`);

        const testDoc = {
            tenant_id: tenantId,
            workspace_id: workspaceId,
            tax_period_id: taxPeriodId,
            invoice_type: 'B2B',
            invoice_number: 'SA_TEST_CONFL_1',
            invoice_date: '2025-04-10',
            book_type: 'SA',
            customer_name: 'Test Customer',
            customer_gstin: '24AALFA9789K1ZO',
            place_of_supply: '24',
            reverse_charge: false,
            is_amendment: false,
            round_off: 0,
            total_taxable_value: 1000,
            total_igst: 180,
            total_cgst: 0,
            total_sgst: 0,
            total_cess: 0,
            total_invoice_value: 1180,
            filing_period: '042025',
            return_period: '042025',
            original_invoice_no: 'SA_TEST_CONFL_1',
            original_invoice_date: '2025-04-10',
            gstr_category: 'B2B',
            t_extra_info: {}
        };

        // Truncate previous test values to ensure clean test
        await client.query("DELETE FROM sales_invoices WHERE invoice_number = 'SA_TEST_CONFL_1'");

        console.log('\n--- Run 1 (New Insert) ---');
        const res1 = await client.query(`
            INSERT INTO sales_invoices (
                tenant_id, workspace_id, tax_period_id, invoice_type,
                invoice_number, invoice_date, book_type, customer_name, customer_gstin,
                total_taxable_value, total_invoice_value, filing_period,
                t_extra_info
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (tenant_id, workspace_id, book_type, invoice_number, tax_period_id)
            DO UPDATE SET
                customer_name = EXCLUDED.customer_name,
                updated_at = NOW()
            RETURNING id, xmax, (xmax = 0) AS is_inserted
        `, [
            testDoc.tenant_id, testDoc.workspace_id, testDoc.tax_period_id, testDoc.invoice_type,
            testDoc.invoice_number, testDoc.invoice_date, testDoc.book_type, testDoc.customer_name, testDoc.customer_gstin,
            testDoc.total_taxable_value, testDoc.total_invoice_value, testDoc.filing_period,
            JSON.stringify(testDoc.t_extra_info)
        ]);
        console.log('Result 1:', res1.rows[0]);

        console.log('\n--- Run 2 (Upsert Conflict) ---');
        const res2 = await client.query(`
            INSERT INTO sales_invoices (
                tenant_id, workspace_id, tax_period_id, invoice_type,
                invoice_number, invoice_date, book_type, customer_name, customer_gstin,
                total_taxable_value, total_invoice_value, filing_period,
                t_extra_info
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (tenant_id, workspace_id, book_type, invoice_number, tax_period_id)
            DO UPDATE SET
                customer_name = EXCLUDED.customer_name,
                updated_at = NOW()
            RETURNING id, xmax, (xmax = 0) AS is_inserted
        `, [
            testDoc.tenant_id, testDoc.workspace_id, testDoc.tax_period_id, testDoc.invoice_type,
            testDoc.invoice_number, testDoc.invoice_date, testDoc.book_type, testDoc.customer_name, testDoc.customer_gstin,
            testDoc.total_taxable_value, testDoc.total_invoice_value, testDoc.filing_period,
            JSON.stringify(testDoc.t_extra_info)
        ]);
        console.log('Result 2:', res2.rows[0]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
