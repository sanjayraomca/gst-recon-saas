const { Client } = require('pg');
const crypto = require('crypto');

function uuidv7() {
    return crypto.randomUUID();
}

async function seed() {
    const client = new Client({
        user: 'gstadmin',
        host: 'localhost',
        database: 'gst_recon',
        password: 'GstAdmin123',
        port: 5435,
    });

    try {
        await client.connect();
        console.log('Connected to database gst_recon');
        
        const workspaceId = '8d84c307-e611-40c7-9d1d-3c04fce101fc';
        const tenantId = 'beb799a7-adb9-4495-b322-935d847f238d';
        const gstn = '24AALFA9789K1ZO';
        const period = '122023'; // Dec 2023
        const fy = '2023-24';
        const genDate = '2024-01-15';

        // Clear existing results for this workspace to avoid confusion
        console.log('Cleaning up existing data for workspace...');
        await client.query('DELETE FROM reconciliation_results WHERE workspace_id = $1', [workspaceId]);
        await client.query('DELETE FROM reconciliation_runs WHERE workspace_id = $1', [workspaceId]);
        await client.query('DELETE FROM normalized_gstr2a_invoices WHERE workspace_id = $1', [workspaceId]);
        await client.query('DELETE FROM normalized_gstr2b_invoices WHERE workspace_id = $1', [workspaceId]);
        await client.query('DELETE FROM gstr_import_master WHERE workspace_id = $1', [workspaceId]);

        // Helper to insert Normalized GSTR data
        async function insertItem(table, data) {
            const cols = Object.keys(data);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const vals = cols.map(c => data[c]);
            const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
            await client.query(query, vals);
        }

        console.log('Seeding GSTR-2A and 2B records...');

        // 0. Create Import Master entries
        const importId2A = uuidv7();
        const importId2B = uuidv7();

        await insertItem('gstr_import_master', {
            import_filing_id: importId2A,
            tenant_uuid: tenantId,
            workspace_id: workspaceId,
            gstin_recipient: gstn,
            return_period: period,
            financial_year: fy,
            generation_date: genDate,
            import_type: 'GSTR2A',
            status: 'Completed',
            original_filename: 'seed_2a.json'
        });

        await insertItem('gstr_import_master', {
            import_filing_id: importId2B,
            tenant_uuid: tenantId,
            workspace_id: workspaceId,
            gstin_recipient: gstn,
            return_period: period,
            financial_year: fy,
            generation_date: genDate,
            import_type: 'GSTR2B',
            status: 'Completed',
            original_filename: 'seed_2b.json'
        });

        // 1. Matched Record
        const matchedInv = 'INV/MATCH/001';
        const baseData = {
            workspace_id: workspaceId,
            tenant_id: tenantId,
            source_section: 'B2B',
            supplier_gstin: '24SUPP0001A1Z1',
            supplier_name: 'SUPPLIER ONE',
            document_number_clean: matchedInv,
            document_number_raw: matchedInv,
            document_date: '2023-12-10',
            document_value: 11800.00,
            taxable_value: 10000.00,
            igst: 1800.00,
            cgst: 0,
            sgst: 0,
            cess: 0,
            total_tax: 1800.00,
            return_period: period,
            is_active: true
        };

        await insertItem('normalized_gstr2a_invoices', { ...baseData, id: uuidv7(), import_filing_id: importId2A, source_table: 'gstr_2a_b2b_invoices' });
        await insertItem('normalized_gstr2b_invoices', { ...baseData, id: uuidv7(), import_filing_id: importId2B, source_table: 'gstr_2b_b2b_invoices' });

        // 2. Mismatch Record (Amount Variance)
        const mismatchInv = 'INV/MISMATCH/002';
        await insertItem('normalized_gstr2a_invoices', {
            ...baseData,
            id: uuidv7(),
            import_filing_id: importId2A,
            source_table: 'gstr_2a_b2b_invoices',
            document_number_clean: mismatchInv,
            document_number_raw: mismatchInv,
            taxable_value: 5000.00,
            igst: 900.00,
            total_tax: 900.00,
            document_value: 5900.00
        });
        await insertItem('normalized_gstr2b_invoices', {
            ...baseData,
            id: uuidv7(),
            import_filing_id: importId2B,
            source_table: 'gstr_2b_b2b_invoices',
            document_number_clean: mismatchInv,
            document_number_raw: mismatchInv,
            taxable_value: 5000.00,
            igst: 1000.00, // Different tax
            total_tax: 1000.00,
            document_value: 6000.00
        });

        // 3. Missing in 2B (Present in 2A)
        await insertItem('normalized_gstr2a_invoices', {
            ...baseData,
            id: uuidv7(),
            import_filing_id: importId2A,
            source_table: 'gstr_2a_b2b_invoices',
            document_number_clean: 'INV/ONLY2A/003',
            document_number_raw: 'INV/ONLY2A/003',
            taxable_value: 2000.00,
            igst: 360.00,
            total_tax: 360.00
        });

        // 4. Missing in 2A (Present in 2B)
        await insertItem('normalized_gstr2b_invoices', {
            ...baseData,
            id: uuidv7(),
            import_filing_id: importId2B,
            source_table: 'gstr_2b_b2b_invoices',
            document_number_clean: 'INV/ONLY2B/004',
            document_number_raw: 'INV/ONLY2B/004',
            taxable_value: 3000.00,
            igst: 540.00,
            total_tax: 540.00
        });

        console.log('Seeding Complete.');

    } catch (err) {
        console.error('Seed error:', err);
    } finally {
        await client.end();
    }
}

seed();
