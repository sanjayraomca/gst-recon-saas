const xlsx = require('xlsx');
const fs = require('fs');

const FILE_PATH = '/home/tanvir/Desktop/gsttool_project/062025_24AALFA9789K1ZO_GSTR2BQ_28072025.xlsx';

try {
    const workbook = xlsx.readFile(FILE_PATH);
    console.log('Sheet Names:', workbook.SheetNames);

    workbook.SheetNames.forEach(sheetName => {
        console.log(`\n--- Sheet: ${sheetName} ---`);
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        // Print first 5 rows to understand structure
        rows.slice(0, 5).forEach(row => console.log(JSON.stringify(row)));
    });

} catch (err) {
    console.error('Error reading file:', err);
}
