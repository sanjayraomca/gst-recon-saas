const { Client } = require('pg');
require('dotenv').config();

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

async function verify() {
    const client = new Client(dbConfig);
    await client.connect();

    const workspaceId = 'b9364d27-cf77-40fc-88fc-954500495d39';
    console.log('--- DB Check for Workspace:', workspaceId);

    // 1. Check Invoice Counts by Document Type
    const counts = await client.query(
        "SELECT document_type, count(*) FROM normalized_gstr2b_invoices WHERE workspace_id = $1 GROUP BY document_type",
        [workspaceId]
    );
    console.log('Document Counts:', counts.rows);

    // 2. Fetch CDNR samples
    const cdnr = await client.query(
        "SELECT supplier_gstin, document_number_clean, document_date, return_period, document_type FROM normalized_gstr2b_invoices WHERE workspace_id = $1 AND (document_type LIKE '%CDN%' OR document_type LIKE '%CRN%')",
        [workspaceId]
    );
    console.log('CDNR Records Found:', cdnr.rows.length);

    if (cdnr.rows.length > 0) {
        console.log('Sample CDNR Keys (Simulated):');
        cdnr.rows.slice(0, 5).forEach(r => {
            const g = (r.supplier_gstin || '').toString().toUpperCase().trim();
            const i = (r.document_number_clean || '').toString().toUpperCase().trim().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
            
            const dObj = new Date(r.document_date);
            const dd = String(dObj.getDate()).padStart(2, '0');
            const mm = String(dObj.getMonth() + 1).padStart(2, '0');
            const yyyy = dObj.getFullYear();
            const d = `${dd}${mm}${yyyy}`;
            
            console.log(`Key: ${g}_${i}_${d} (Raw Num: ${r.document_number_clean}, Raw Date: ${r.document_date})`);
        });
    }

    await client.end();
}

verify().catch(console.error);
