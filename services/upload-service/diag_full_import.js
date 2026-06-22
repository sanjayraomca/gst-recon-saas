const xlsx = require('xlsx');
const fs = require('fs');
const { processPurchaseSheet } = require('./src/utils/bookSheetProcessors');
const BookModel = require('./src/models/bookModel');
const db = require('../shared/src/db/connection');

const filePath = '/home/tanvir/Desktop/gsttool_project/GSTR2B./a1b_purchase_book_data_fy2017_fy2025-26.csv';
const tenantId = '7f1a7ebe-a5f3-41ca-a78e-f543dcc4bfc6';
const workspaceId = '24315302-401d-4446-bbed-c6ccb8c19b4f';
const orgGstin = '24AALFA9789K1ZO';

async function main() {
    try {
        console.log('Reading file...');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        console.log(`Read ${jsonRows.length} rows.`);

        console.log('Processing sheet...');
        const vouchers = processPurchaseSheet(jsonRows, tenantId, workspaceId, null, '032026', orgGstin, 'PURCHASE');
        console.log(`Processed into ${vouchers.length} unique vouchers.`);

        console.log('Starting bulk insert...');
        const startTime = Date.now();
        const result = await BookModel.bulkInsertPurchase(vouchers);
        const endTime = Date.now();

        console.log(`Bulk insert completed in ${endTime - startTime} ms`);
        console.log(`Inserted: ${result.inserted}`);
        console.log(`Duplicates: ${result.duplicateInvoices.length}`);

    } catch (err) {
        console.error('DIAGNOSTIC FAILED:');
        console.error(err);
        if (err.detail) console.error('Detail:', err.detail);
        if (err.hint) console.error('Hint:', err.hint);
        if (err.where) console.error('Where:', err.where);
    } finally {
        await db.destroy();
    }
}

main();
