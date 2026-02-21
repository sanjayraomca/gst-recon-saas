
const { processB2BSheet } = require('../services/upload-service/src/utils/sheetProcessors');

// Mock data for B2B sheet
const b2bRows = [
    ['GSTIN of Supplier', 'Trade/Legal name', 'Invoice Number', 'Invoice type', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Reverse Charge', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'],
    ['29AABCD1234E1ZF', 'ABC Enterprises', 'INV-001', 'Regular', '01-11-2024', 118000, '29-Karnataka', 'N', 100000, 0, 9000, 9000, 0]
];

// Mock data for B2BA sheet
const b2baRows = [
    ['GSTIN of Supplier', 'Trade/Legal name', 'Original Invoice Number', 'Original Invoice Date', 'Revised Invoice Number', 'Revised Invoice Date', 'Invoice type', 'Invoice Value', 'Place of Supply', 'Reverse Charge', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'],
    ['29AABCD1234E1ZF', 'ABC Enterprises', 'INV-001', '01-11-2024', 'INV-001-A', '05-11-2024', 'Regular', 120000, '29-Karnataka', 'N', 105000, 0, 9450, 9450, 0]
];

// Mock data for CDNR sheet
const cdnrRows = [
    ['GSTIN of Supplier', 'Trade/Legal name', 'Note Type', 'Note Number', 'Note Date', 'Original Invoice Number', 'Original Invoice Date', 'Note Value', 'Place of Supply', 'Reverse Charge', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability'],
    ['29AABCD1234E1ZF', 'ABC Enterprises', 'C', 'CN-001', '10-11-2024', 'INV-001', '01-11-2024', 5000, '29-Karnataka', 'N', 4000, 0, 360, 360, 0, 'Y']
];

// Mock data for CDNRA sheet
const cdnraRows = [
    ['GSTIN of Supplier', 'Trade/Legal name', 'Original Note Number', 'Original Note Date', 'Revised Note Number', 'Revised Note Date', 'Note Type', 'Note Value', 'Place of Supply', 'Reverse Charge', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'],
    ['29AABCD1234E1ZF', 'ABC Enterprises', 'CN-001', '10-11-2024', 'CN-001-A', '12-11-2024', 'C', 5500, '29-Karnataka', 'N', 4500, 0, 405, 405, 0]
];

// Mock data for IMPG sheet
const impgRows = [
    ['Port Code', 'Boe Number', 'Boe Date', 'Icegate Reference Date', 'Taxable Value', 'Integrated Tax', 'Cess', 'ITC Availability'],
    ['INNSA1', 'BOE-001', '15-11-2024', '16-11-2024', 500000, 90000, 0, 'Y']
];

// Mock data for ISD sheet
const isdRows = [
    ['GSTIN of ISD', 'ISD Name', 'ISD Document Number', 'ISD Document Date', 'ITC Availability', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'],
    ['29ISD1234E1ZF', 'ISD Head Office', 'ISD-001', '20-11-2024', 'Y', 5000, 0, 0, 0]
];

const { processISDSheet, processImportSheet } = require('../services/upload-service/src/utils/sheetProcessors');

function runTest() {
    console.log('--- Testing B2B Sheet ---');
    const b2bResults = processB2BSheet(b2bRows, 'gstin-123', '112024', 'B2B');
    console.log('B2B Results count:', b2bResults.length);
    console.log('First Record target_table:', b2bResults[0].target_table);

    console.log('\n--- Testing B2BA Sheet ---');
    const b2baResults = processB2BSheet(b2baRows, 'gstin-123', '112024', 'B2BA');
    console.log('B2BA Results count:', b2baResults.length);
    console.log('First Record target_table:', b2baResults[0].target_table);
    console.log('Original Invoice Number:', b2baResults[0].original_invoice_number);

    console.log('\n--- Testing CDNR Sheet ---');
    const cdnrResults = processB2BSheet(cdnrRows, 'gstin-123', '112024', 'B2B-CDNR');
    console.log('CDNR Results count:', cdnrResults.length);
    console.log('First Record target_table:', cdnrResults[0].target_table);
    console.log('Note Number:', cdnrResults[0].note_number);

    console.log('\n--- Testing CDNRA Sheet ---');
    const cdnraResults = processB2BSheet(cdnraRows, 'gstin-123', '112024', 'B2B-CDNRA');
    console.log('CDNRA Results count:', cdnraResults.length);
    console.log('First Record target_table:', cdnraResults[0].target_table);
    console.log('Original Note Number:', cdnraResults[0].original_note_number);
    console.log('Revised Note Number:', cdnraResults[0].revised_note_number);

    console.log('\n--- Testing IMPG Sheet ---');
    const impgResults = processImportSheet(impgRows, 'gstin-123', '112024');
    console.log('IMPG Results count:', impgResults.length);
    console.log('First Record target_table:', impgResults[0].target_table);
    console.log('BOE Number:', impgResults[0].boe_number);

    console.log('\n--- Testing ISD Sheet ---');
    const isdResults = processISDSheet(isdRows, 'gstin-123', '112024', 'ISD');
    console.log('ISD Results count:', isdResults.length);
    console.log('First Record target_table:', isdResults[0].target_table);
    console.log('Document Number:', isdResults[0].document_number);

    // Validation
    const errors = [];
    if (b2bResults[0].target_table !== 'gstr_2b_b2b_invoices') errors.push('B2B target_table mismatch');
    if (b2baResults[0].target_table !== 'gstr_2b_b2ba_invoices') errors.push('B2BA target_table mismatch');
    if (cdnrResults[0].target_table !== 'gstr_2b_cdnr') errors.push('CDNR target_table mismatch');
    if (cdnraResults[0].target_table !== 'gstr_2b_cdnra') errors.push('CDNRA target_table mismatch');
    if (impgResults[0].target_table !== 'gstr_2b_impg') errors.push('IMPG target_table mismatch');
    if (isdResults[0].target_table !== 'gstr_2b_isd') errors.push('ISD target_table mismatch');

    if (errors.length > 0) {
        console.error('\nTests FAILED:');
        errors.forEach(err => console.error(' - ' + err));
        process.exit(1);
    } else {
        console.log('\nAll processing tests PASSED!');
    }
}

runTest();
