const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '../src/connectors/mock-adesk-data.json');

function run() {
    if (!fs.existsSync(jsonPath)) {
        console.error('Mock JSON data not found!');
        return;
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`Total parsed records: ${data.length}`);

    const quarters = {
        Q1: { start: new Date('2025-04-01'), end: new Date('2025-06-30'), count: 0 },
        Q2: { start: new Date('2025-07-01'), end: new Date('2025-09-30'), count: 0 },
        Q3: { start: new Date('2025-10-01'), end: new Date('2025-12-31'), count: 0 },
        Q4: { start: new Date('2026-01-01'), end: new Date('2026-03-31'), count: 0 },
    };

    data.forEach(row => {
        const dateStr = row.vchr_date || row.supplier_invoice_date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        for (const [q, range] of Object.entries(quarters)) {
            if (d >= range.start && d <= range.end) {
                range.count++;
                break;
            }
        }
    });

    console.table(Object.entries(quarters).map(([q, range]) => ({
        Quarter: q,
        'Start Date': range.start.toISOString().split('T')[0],
        'End Date': range.end.toISOString().split('T')[0],
        Count: range.count
    })));
}

run();
