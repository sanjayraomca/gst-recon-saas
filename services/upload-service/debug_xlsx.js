const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = '/home/tanvir/Desktop/gsttool_project/GSTR2B./a1b_purchase_book_data_fy2017_fy2025-26.csv';

console.log('Starting debug script...');
console.log('File path:', filePath);

try {
    if (!fs.existsSync(filePath)) {
        console.error('File does not exist!');
        process.exit(1);
    }

    const stats = fs.statSync(filePath);
    console.log('File size:', stats.size, 'bytes');

    console.log('Attempting to read workbook with xlsx...');
    const startTime = Date.now();
    const workbook = xlsx.readFile(filePath);
    const endTime = Date.now();
    console.log('Successfully read workbook in', (endTime - startTime), 'ms');

    const sheetName = workbook.SheetNames[0];
    console.log('Sheet name:', sheetName);

    console.log('Converting sheet to json...');
    const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    console.log('Total rows converted:', jsonRows.length);

    if (jsonRows.length > 0) {
        console.log('First row (likely header):', JSON.stringify(jsonRows[0]));
        if (jsonRows.length > 1) {
            console.log('Second row (first data):', JSON.stringify(jsonRows[1]));
        }
    }

    console.log('Debug script completed successfully.');
} catch (error) {
    console.error('An error occurred during debug execution:');
    console.error(error);
    process.exit(1);
}
