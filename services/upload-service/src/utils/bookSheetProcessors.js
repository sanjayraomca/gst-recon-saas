const { isValidGSTIN, normalizeInvoiceNumber, parseExcelDate, cleanAmount } = require('./validation');

/**
 * Book Data Sheet Processors
 * Maps Sales/Purchase Register Excel columns to Database Schema
 */

const getHeaderIndex = (rows, keywords) => {
    // Standard keywords to help identify header rows
    const allKeywords = [...keywords, 'VOUCHER', 'AMT', 'NET', 'VCHR'];
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const rowStr = rows[i]?.join(' ').toUpperCase() || '';
        let matchCount = 0;
        for (const k of allKeywords) {
            if (rowStr.includes(k.toUpperCase())) matchCount++;
        }
        if (matchCount >= 2) return i;
    }
    return -1;
};

const buildColumnMap = (headerRow) => {
    const colMap = {};
    headerRow.forEach((cell, index) => {
        const header = cell?.toString().toUpperCase().trim() || '';

        // Helper to check both "WORD WORD" and "WORD_WORD"
        const has = (str) => header.includes(str) || header.includes(str.replace(' ', '_'));

        // Common
        if (has('GSTIN')) colMap['gstin'] = index;
        else if (has('PARTY NAME') || has('CUSTOMER NAME') || has('SUPPLIER NAME') || has('PARTY_NAME')) colMap['party_name'] = index;
        else if (has('INVOICE NUMBER') || has('VOUCHER NUMBER') || has('INV NO') || has('VCHR NO') || has('INVOICE NO') || has('VOUCHER NO')) colMap['invoice_number'] = index;
        else if (has('INVOICE DATE') || has('VOUCHER DATE') || has('INV DATE') || has('VCHR DATE') || header === 'DATE' || header === 'VCHR_DATE' || header === 'INV_DATE') colMap['invoice_date'] = index;
        else if (has('INVOICE VALUE') || has('TOTAL VALUE') || has('NET AMOUNT') || has('INV AMT') || has('VCHR AMT') || has('NET_AMT') || has('INVOICE AMOUNT') || has('VCHR_AMT')) colMap['invoice_value'] = index;
        else if (has('PLACE OF SUPPLY') || has('POS') || has('STATE') || has('PARTY_STATE')) colMap['place_of_supply'] = index;
        else if (has('ROUND OFF') || has('ROUND_OFF')) colMap['round_off'] = index;
        else if (has('REVERSE CHARGE') || has('RCM')) colMap['reverse_charge'] = index;
        else if (has('INVOICE TYPE') || has('DOCUMENT TYPE') || has('VCHR TYPE')) colMap['invoice_type'] = index;
        else if (has('BOOK TYPE')) colMap['book_type'] = index; // SA, SR, CN, DN
        else if (has('DISCOUNT')) colMap['discount'] = index;

        // Line Item Details
        else if (has('TAXABLE VALUE') || has('TAXABLE AMOUNT') || has('TAXABLE AMT') || has('TAXABLE_AMT')) colMap['taxable_value'] = index;
        else if (has('IGST')) colMap['igst_amount'] = index;
        else if (has('CGST')) colMap['cgst_amount'] = index;
        else if (has('SGST')) colMap['sgst_amount'] = index;
        else if (has('CESS')) colMap['cess_amount'] = index;
        else if (has('RATE') || has('TAX RATE') || has('TAX PER')) colMap['rate'] = index;
        else if (has('HSN') || has('SAC')) colMap['hsn_code'] = index;
        else if (has('QUANTITY') || has('QTY')) colMap['quantity'] = index;
        else if (has('UOM') || has('UNIT')) colMap['uom'] = index;
        else if (has('ITEM DESCRIPTION') || has('DESCRIPTION')) colMap['description'] = index;

        // Purchase Specific
        else if (has('ITC ELIGIBLE')) colMap['itc_eligible'] = index;
        else if (has('ITC CLAIMED')) colMap['itc_claimed'] = index;
    });
    return colMap;
};

const processSalesSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod) => {
    // Key identifiers for Sales Register
    const headerRowIndex = getHeaderIndex(rows, ['INVOICE', 'DATE', 'VALUE']);
    if (headerRowIndex === -1) return [];

    const headerRow = rows[headerRowIndex];
    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + 1;

    // Use a map to aggregate line items under invoices if mostly flat file
    // Key: invoice_number + invoice_date
    const invoiceMap = new Map();

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;

        let invNumRaw = row[colMap['invoice_number']]?.toString().trim();
        if (!invNumRaw || invNumRaw.toUpperCase().includes('TOTAL')) continue; // Skip empty or total rows
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) continue;

        const customerGstin = colMap['gstin'] !== undefined ? row[colMap['gstin']]?.toString().trim() : null;
        if (customerGstin && !isValidGSTIN(customerGstin)) continue; // Skip invalid GSTINs

        const invDateRaw = row[colMap['invoice_date']];
        const invDate = parseExcelDate(invDateRaw);
        if (!invDate) continue; // Skip if invalid date

        // Composite Key for grouping items
        const groupKey = `${invNum}_${invDate}`;

        if (!invoiceMap.has(groupKey)) {
            // New Invoice Header
            invoiceMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId,
                    invoice_number: invNum,
                    invoice_date: invDate,
                    invoice_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'B2B',
                    book_type: colMap['book_type'] !== undefined ? row[colMap['book_type']] : 'SA', // SA=Sales
                    customer_name: colMap['party_name'] !== undefined ? row[colMap['party_name']] : null,
                    customer_gstin: customerGstin,
                    place_of_supply: colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null,
                    reverse_charge: colMap['reverse_charge'] !== undefined ? (row[colMap['reverse_charge']]?.toString().toUpperCase().startsWith('Y')) : false,
                    total_invoice_value: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),
                    // Totals will be aggregated
                    total_taxable_value: 0,
                    total_igst: 0,
                    total_cgst: 0,
                    total_sgst: 0,
                    total_cess: 0,
                    filing_period: returnPeriod // Store just in case
                },
                items: []
            });
        }

        const invoiceGroup = invoiceMap.get(groupKey);

        // Extract Line Item
        const taxable = cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0);
        const igst = cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0);
        const cgst = cleanAmount(colMap['cgst_amount'] !== undefined ? row[colMap['cgst_amount']] : 0);
        const sgst = cleanAmount(colMap['sgst_amount'] !== undefined ? row[colMap['sgst_amount']] : 0);
        const cess = cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0);
        const total = taxable + igst + cgst + sgst + cess;

        invoiceGroup.items.push({
            hsn_sac_code: colMap['hsn_code'] !== undefined ? row[colMap['hsn_code']]?.toString() : null,
            description: colMap['description'] !== undefined ? row[colMap['description']] : null,
            quantity: cleanAmount(colMap['quantity'] !== undefined ? row[colMap['quantity']] : 0),
            uom: colMap['uom'] !== undefined ? row[colMap['uom']] : null,
            unit_rate: cleanAmount(colMap['rate'] !== undefined ? row[colMap['rate']] : 0),
            taxable_value: taxable,
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: total
        });

        // Update Header Totals
        invoiceGroup.header.total_taxable_value += taxable;
        invoiceGroup.header.total_igst += igst;
        invoiceGroup.header.total_cgst += cgst;
        invoiceGroup.header.total_sgst += sgst;
        invoiceGroup.header.total_cess += cess;
    }

    // Convert Map to Array
    return Array.from(invoiceMap.values());
};

const normalizeVoucherType = (val) => {
    if (!val) return 'PURCHASE';
    const str = val.toString().toUpperCase().trim();
    if (str === 'EXP' || str === 'EXPENSE') return 'EXPENSE';
    if (str === 'DN' || str === 'DEBIT NOTE' || str === 'DEBIT_NOTE') return 'DEBIT_NOTE';
    if (str === 'CN' || str === 'CREDIT NOTE' || str === 'CREDIT_NOTE') return 'CREDIT_NOTE';
    return 'PURCHASE';
};

const processPurchaseSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod) => {
    // Key identifiers for Purchase Register
    const headerRowIndex = getHeaderIndex(rows, ['INVOICE', 'DATE', 'VALUE']);
    if (headerRowIndex === -1) return [];

    const headerRow = rows[headerRowIndex];
    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + 1;

    const voucherMap = new Map();

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3) continue;

        let invNumRaw = row[colMap['invoice_number']]?.toString().trim();
        if (!invNumRaw || invNumRaw.toUpperCase().includes('TOTAL')) continue;
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) continue;

        const supplierGstin = colMap['gstin'] !== undefined ? row[colMap['gstin']]?.toString().trim() : null;
        if (supplierGstin && !isValidGSTIN(supplierGstin)) continue;

        const invDateRaw = row[colMap['invoice_date']];
        const invDate = parseExcelDate(invDateRaw);
        if (!invDate) continue;

        // Composite Key
        const groupKey = `${invNum}_${invDate}`;

        if (!voucherMap.has(groupKey)) {
            voucherMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId,
                    voucher_type: normalizeVoucherType(colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'PURCHASE'),
                    book_type: colMap['book_type'] !== undefined ? row[colMap['book_type']] : 'SR', // Map to real data book_type (SR, CN, DN)
                    supplier_invoice_no: invNum,
                    supplier_invoice_date: invDate,
                    supplier_name: colMap['party_name'] !== undefined ? row[colMap['party_name']] : null,
                    supplier_gstin: supplierGstin,
                    place_of_supply: colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null,
                    round_off: cleanAmount(colMap['round_off'] !== undefined ? row[colMap['round_off']] : 0),

                    taxable_total: 0,
                    total_cgst_amount: 0,
                    total_sgst_amount: 0,
                    total_igst_amount: 0,
                    total_cess_amount: 0,
                    total_qty: 0,
                    discount: cleanAmount(colMap['discount'] !== undefined ? row[colMap['discount']] : 0),
                    net_amount: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0), // Total Invoice Value

                    itc_eligible: colMap['itc_eligible'] !== undefined ? (row[colMap['itc_eligible']]?.toString().toUpperCase().startsWith('Y')) : true,
                    itc_claimed: colMap['itc_claimed'] !== undefined ? (row[colMap['itc_claimed']]?.toString().toUpperCase().startsWith('Y')) : false,

                    filing_period: returnPeriod
                },
                items: []
            });
        }

        const voucherGroup = voucherMap.get(groupKey);

        const taxable = cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0);
        const igst = cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0);
        const cgst = cleanAmount(colMap['cgst_amount'] !== undefined ? row[colMap['cgst_amount']] : 0);
        const sgst = cleanAmount(colMap['sgst_amount'] !== undefined ? row[colMap['sgst_amount']] : 0);
        const cess = cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0);
        const total = taxable + igst + cgst + sgst + cess;

        voucherGroup.items.push({
            hsn_code: colMap['hsn_code'] !== undefined ? row[colMap['hsn_code']]?.toString() : null,
            description: colMap['description'] !== undefined ? row[colMap['description']] : null,
            quantity: cleanAmount(colMap['quantity'] !== undefined ? row[colMap['quantity']] : 0),
            uom: colMap['uom'] !== undefined ? row[colMap['uom']] : null,
            unit_rate: cleanAmount(colMap['rate'] !== undefined ? row[colMap['rate']] : 0),
            taxable_amount: taxable,
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: total
        });

        voucherGroup.header.taxable_total += taxable;
        voucherGroup.header.total_igst_amount += igst;
        voucherGroup.header.total_cgst_amount += cgst;
        voucherGroup.header.total_sgst_amount += sgst;
        voucherGroup.header.total_cess_amount += cess;
        voucherGroup.header.total_qty += cleanAmount(colMap['quantity'] !== undefined ? row[colMap['quantity']] : 0);

        // Recalculate net_amount to ensure perfection as per user request
        // net_amount = taxable_total + total_taxes - discount + round_off
        const totalTaxes = voucherGroup.header.total_igst_amount + voucherGroup.header.total_cgst_amount + voucherGroup.header.total_sgst_amount + voucherGroup.header.total_cess_amount;
        voucherGroup.header.net_amount = voucherGroup.header.taxable_total + totalTaxes - voucherGroup.header.discount + (voucherGroup.header.round_off || 0);
    }

    return Array.from(voucherMap.values());
};

module.exports = {
    processSalesSheet,
    processPurchaseSheet
};
