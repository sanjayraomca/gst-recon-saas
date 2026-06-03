// Set connection env vars first
process.env.DB_USER = 'gstadmin';
process.env.DB_PASSWORD = 'GstAdmin123';
process.env.DB_NAME = 'gst_recon';
process.env.DB_PORT = '5435';

const xlsx = require('xlsx');
const fs = require('fs');
const { processPurchaseSheet } = require('./src/utils/bookSheetProcessors');
const BookModel = require('./src/models/bookModel');
const db = require('../shared/src/db/connection');

const filePath = '/home/tanvir/Desktop/gsttool_project/PurchaseDataGroupByTaxPecentage20260602073441.xlsx';
const tenantId = '789aab4b-d541-4063-b7d5-c70a56964849';
const workspaceId = 'f86964e5-df07-4d32-8c63-3105c577a7b6';
const orgGstin = '24DGLPP8130C1ZH';

async function main() {
    try {
        console.log('Reading file...');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        console.log(`Read ${jsonRows.length} rows.`);

        console.log('Processing sheet...');
        const vouchers = processPurchaseSheet(jsonRows, tenantId, workspaceId, null, '042025', orgGstin, 'PURCHASE');
        console.log('Processed vouchers list:', JSON.stringify(vouchers, null, 2));

        console.log('Starting bulk insert...');
        const result = await BookModel.bulkInsertPurchase(vouchers);
        console.log('Bulk insert completed.');
        console.log('Inserted count:', result.inserted);
        console.log('Duplicates/Updated list:', JSON.stringify(result.duplicateInvoices));

        // Query the database to see what was inserted
        const dbVouchers = await db('purchase_vouchers').where('workspace_id', workspaceId);
        console.log('Vouchers in DB:', JSON.stringify(dbVouchers, null, 2));
        
        const dbItems = await db('purchase_items').whereIn('purchase_id', dbVouchers.map(v => v.id));
        console.log('Items in DB:', JSON.stringify(dbItems, null, 2));

    } catch (err) {
        console.error('DIAGNOSTIC FAILED:');
        console.error(err);
    } finally {
        await db.destroy();
    }
}

main();
