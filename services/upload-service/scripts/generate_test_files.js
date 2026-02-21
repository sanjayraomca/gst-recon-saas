const xlsx = require('xlsx');

// Valid Sales Register Data (Matches Workspace GSTIN: 27AAACW1234A1Z5)
const salesData = [
    ["TAXPAYER GSTIN", "27AAACW1234A1Z5"], // The newly added validation row
    [],
    ["INVOICE NUMBER", "INVOICE DATE", "CUSTOMER NAME", "GSTIN", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS", "TOTAL VALUE", "INVOICE TYPE", "BOOK TYPE", "PLACE OF SUPPLY"],
    ["SK/25-26/001", "01/04/2025", "Alpha Corp", "27AAACW9999Z9Z9", 10000, 1800, 0, 0, 0, 11800, "B2B", "SA", "27-Maharashtra"],
    ["SK/25-26/002", "02/04/2025", "Beta Ltd", "27AAACW8888Y8Y8", 5000, 0, 450, 450, 0, 5900, "B2B", "SA", "27-Maharashtra"],
    ["SK/25-26/003", "05/04/2025", "Gamma Inc", "29AAACW7777X7X7", 20000, 3600, 0, 0, 0, 23600, "B2B", "SA", "29-Karnataka"]
];

const wbSales = xlsx.utils.book_new();
const wsSales = xlsx.utils.aoa_to_sheet(salesData);
xlsx.utils.book_append_sheet(wbSales, wsSales, "Sales");
xlsx.writeFile(wbSales, 'sales_register.xlsx');
console.log('Created sales_register.xlsx');

// Invalid Sales Register Data (Wrong Taxpayer GSTIN)
const invalidSalesData = [
    ["TAXPAYER GSTIN", "07AAACW9999X1Z9"], // Wrong GSTIN
    [],
    ["INVOICE NUMBER", "INVOICE DATE", "CUSTOMER NAME", "GSTIN", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS", "TOTAL VALUE", "INVOICE TYPE", "BOOK TYPE", "PLACE OF SUPPLY"],
    ["SK/25-26/001", "01/04/2025", "Alpha Corp", "27AAACW9999Z9Z9", 10000, 1800, 0, 0, 0, 11800, "B2B", "SA", "27-Maharashtra"]
];

const wbInvalidSales = xlsx.utils.book_new();
const wsInvalidSales = xlsx.utils.aoa_to_sheet(invalidSalesData);
xlsx.utils.book_append_sheet(wbInvalidSales, wsInvalidSales, "Sales");
xlsx.writeFile(wbInvalidSales, 'invalid_sales_register.xlsx');
console.log('Created invalid_sales_register.xlsx');

// Valid Purchase Register Data
const purchaseData = [
    ["TAXPAYER GSTIN", "27AAACW1234A1Z5"], // The newly added validation row
    [],
    ["INVOICE NUMBER", "INVOICE DATE", "SUPPLIER NAME", "GSTIN", "TAXABLE VALUE", "IGST", "CGST", "SGST", "CESS", "TOTAL VALUE", "ITC ELIGIBLE", "ITC CLAIMED"],
    ["PUR/001", "10/04/2025", "Vendor X", "27AAACW1111D1Z0", 15000, 2700, 0, 0, 0, 17700, "YES", "YES"],
    ["PUR/002", "12/04/2025", "Vendor Y", "27AAACW2222E1Z6", 8000, 0, 720, 720, 0, 9440, "YES", "NO"]
];

const wbPurchase = xlsx.utils.book_new();
const wsPurchase = xlsx.utils.aoa_to_sheet(purchaseData);
xlsx.utils.book_append_sheet(wbPurchase, wsPurchase, "Purchase");
xlsx.writeFile(wbPurchase, 'purchase_register.xlsx');
console.log('Created purchase_register.xlsx');
