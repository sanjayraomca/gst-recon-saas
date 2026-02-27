const fs = require('fs');
const xlsx = require('xlsx');
const { processPurchaseSheet } = require('./src/utils/bookSheetProcessors');

const workbook = xlsx.readFile('../../../a1b_book_data.csv');
const sheetName = workbook.SheetNames[0];
const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

const result = processPurchaseSheet(jsonRows, 'tenant', 'workspace', 'taxPeriod', 'period', 'orgGstin', 'PURCHASE');
console.log(result.slice(0, 5).map(r => ({ invoice: r.header.supplier_invoice_no, voucherType: r.header.voucher_type, bookType: r.header.book_type })));
