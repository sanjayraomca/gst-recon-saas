const xlsx = require('xlsx');
const filePath = '/home/tanvir/Desktop/gsttool_project/PurchaseDataGroupByTaxPecentage20260602073441.xlsx';

try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    const headers = jsonRows[0].map(h => (h || '').toString().toLowerCase().trim());
    const vchrNoIdx = headers.indexOf('vchr_full_number');
    const vchrDateIdx = headers.indexOf('vchr_date');
    const invAmtIdx = headers.indexOf('invoice_amount');
    const rowAmtIdx = headers.indexOf('row_wise_total_amount');
    const taxPerIdx = headers.indexOf('tax_per');

    console.log(`vchrNoIdx: ${vchrNoIdx}, vchrDateIdx: ${vchrDateIdx}, invAmtIdx: ${invAmtIdx}, rowAmtIdx: ${rowAmtIdx}, taxPerIdx: ${taxPerIdx}`);

    const counts = {};
    for (let i = 1; i < jsonRows.length; i++) {
        const row = jsonRows[i];
        if (!row || row.length === 0) continue;
        const vchrNo = row[vchrNoIdx];
        if (!vchrNo) continue;
        counts[vchrNo] = (counts[vchrNo] || 0) + 1;
    }

    console.log("Vouchers with multiple rows:");
    for (const [vchr, cnt] of Object.entries(counts)) {
        if (cnt > 1) {
            console.log(`- ${vchr}: ${cnt} rows`);
            // print the rows
            for (let i = 1; i < jsonRows.length; i++) {
                const row = jsonRows[i];
                if (row[vchrNoIdx] === vchr) {
                    console.log(`  Row ${i}: Tax%=${row[taxPerIdx]}, RowTotal=${row[rowAmtIdx]}, InvTotal=${row[invAmtIdx]}`);
                }
            }
        }
    }
} catch (e) {
    console.error(e);
}
