const { Client } = require('pg');

const dbConfig = {
    host: '127.0.0.1',
    port: 5435,
    database: 'gst_recon',
    user: 'gstadmin',
    password: 'GstAdmin123',
};

// Replicate frontend normalizeDate
const normalizeDate = (dObj) => {
    if (!dObj || dObj === '-') return '';

    let date;
    if (dObj instanceof Date) {
        date = dObj;
    } else {
        const s = String(dObj).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [y, m, d] = s.split('-');
            return `${d}${m}${y}`;
        } else if (s.includes('T')) {
            date = new Date(s); 
        } else if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
            return s.replace(/[-/]/g, '');
        } else {
            date = new Date(s);
        }
    }

    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}${mm}${yyyy}`;
};

async function verify() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        
        const workspaceId = 'b9364d27-cf77-40fc-88fc-954500495d39';
        
        console.log('--- Simulating Backend API Response ---');
        const res = await client.query(`
            SELECT 
                invoice_number as "invoiceNo",
                to_char(invoice_date, 'DD-MM-YYYY') as "date",
                trim(customer_gstin) as "gstin"
            FROM sales_invoices 
            WHERE workspace_id = $1 
            LIMIT 10
        `, [workspaceId]);
        
        const existingRecordsList = res.rows;
        console.log('Backend Data (Sample):', existingRecordsList[0]);

        const existingMap = new Set(existingRecordsList.map(r => {
            const iStr = r.invoiceNo || '';
            const dStr = r.date || '';
            
            const i = iStr.toString().toUpperCase().trim().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
            const d = dStr.replace(/[^0-9]/g, '');
            
            const g = (r.gstin || '').toString().toUpperCase().trim();
            const key = g ? `${g}_${i}_${d}` : `${i}_${d}`;
            return key;
        }));

        console.log('Existing Keys Map (Sample):', Array.from(existingMap).slice(0, 5));

        // SIMULATE AN UPLOADED ROW
        const uploadedRow = {
            "Invoice Number": "INV7",
            "Date": "05/12/2025",
            "GSTIN": ""
        };

        const rowGstin = uploadedRow["GSTIN"] || "";
        const rowInv = uploadedRow["Invoice Number"] || "";
        const rowDate = uploadedRow["Date"] || "";

        const g = rowGstin.toString().toUpperCase().trim();
        const i = rowInv.toString().toUpperCase().trim().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
        const d = normalizeDate(rowDate);

        const key = g ? `${g}_${i}_${d}` : `${i}_${d}`;
        console.log('Simulated Row Key:', key);
        console.log('Is Duplicate?', existingMap.has(key));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

verify();
