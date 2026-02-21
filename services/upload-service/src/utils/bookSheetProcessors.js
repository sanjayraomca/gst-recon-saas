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
        const has = (str) => header.includes(str) || header.includes(str.replace(/ /g, '_'));

        // Common
        if (has('GSTIN')) colMap['gstin'] = index;
        else if (has('PARTY NAME') || has('CUSTOMER NAME') || has('SUPPLIER NAME') || has('PARTY_NAME')) colMap['party_name'] = index;
        else if (has('INVOICE NUMBER') || has('VOUCHER NUMBER') || has('INV NO') || has('VCHR NO') || has('INVOICE NO') || has('VOUCHER NO') || has('BILL NO') || has('BILL_NO') || has('SL NO') || has('SL_NO') || has('SERIAL NO') || header === 'NO' || header === 'BILL') colMap['invoice_number'] = index;
        else if (has('INVOICE DATE') || has('VOUCHER DATE') || has('INV DATE') || has('VCHR DATE') || header === 'DATE' || header === 'VCHR_DATE' || header === 'INV_DATE') colMap['invoice_date'] = index;
        else if (has('INVOICE VALUE') || has('TOTAL VALUE') || has('NET AMOUNT') || has('INV AMT') || has('VCHR AMT') || has('NET_AMT') || has('INVOICE AMOUNT') || has('VCHR_AMT') || has('INVOICE AMT') || has('TOTAL AMT') || has('BILL AMOUNT') || has('TOTAL AMOUNT') || has('BILL_AMT') || has('INV_AMT') || has('ROW_WISE_TOTAL_AMOUNT') || has('INVOICE_AMOUNT')) colMap['invoice_value'] = index;
        else if (has('PLACE OF SUPPLY') || has('POS')) colMap['place_of_supply'] = index;
        else if (has('PARTY STATE') || has('PARTY_STATE')) colMap['party_state'] = index;
        else if (has('INTER STATE') || has('INTER_STATE') || header === 'INTERSTATE') colMap['inter_state'] = index;
        else if (has('ROUND OFF') || has('ROUND_OFF')) colMap['round_off'] = index;
        else if (has('REVERSE CHARGE') || has('RCM')) colMap['reverse_charge'] = index;
        else if (has('INVOICE TYPE') || has('DOCUMENT TYPE') || has('VCHR TYPE')) colMap['invoice_type'] = index;
        else if (has('BOOK TYPE')) colMap['book_type'] = index; // SA, SR, CN, DN
        else if (has('DISCOUNT')) colMap['discount'] = index;

        // Line Item Details
        else if (has('TAXABLE VALUE') || has('TAXABLE AMOUNT') || has('TAXABLE AMT') || has('TAXABLE_AMT') || has('TOTAL TAXABLE AMOUNT') || has('TOTAL_TAXABLE_AMOUNT')) colMap['taxable_value'] = index;
        else if (has('IGST') || has('TOTAL IGST TAX AMOUNT') || has('TOTAL_IGST_TAX_AMOUNT')) colMap['igst_amount'] = index;
        else if (has('CGST') || has('TOTAL CGST TAX AMOUNT') || has('TOTAL_CGST_TAX_AMOUNT')) colMap['cgst_amount'] = index;
        else if (has('SGST') || has('TOTAL SGST TAX AMOUNT') || has('TOTAL_SGST_TAX_AMOUNT')) colMap['sgst_amount'] = index;
        else if (has('CESS') || has('TOTAL CESS TAX AMOUNT') || has('TOTAL_CESS_TAX_AMOUNT')) colMap['cess_amount'] = index;
        else if (has('RATE') || has('TAX RATE') || has('TAX PER')) colMap['rate'] = index;
        else if (has('HSN') || has('SAC')) colMap['hsn_code'] = index;
        else if (has('QUANTITY') || has('QTY')) colMap['quantity'] = index;
        else if (has('UOM') || has('UNIT')) colMap['uom'] = index;
        else if (has('ITEM DESCRIPTION') || has('DESCRIPTION')) colMap['description'] = index;
        else if (has('REMARKS')) colMap['remarks'] = index;

        // Purchase Specific
        else if (has('ITC ELIGIBLE')) colMap['itc_eligible'] = index;
        else if (has('ITC CLAIMED')) colMap['itc_claimed'] = index;
    });

    console.log('[DEBUG] Calculated colMap:', JSON.stringify(colMap));
    return colMap;
};

const processSalesSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin) => {
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

                    // Derivation rules:
                    // 1. place_of_supply defaults to mapped column, if not present fallback to first 2 digits of customerGstin
                    // 2. is_interstate is true if the first 2 digits of the Org GSTIN and customerGstin differ
                    place_of_supply: colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : (customerGstin ? customerGstin.substring(0, 2) : null),

                    is_interstate: orgGstin && customerGstin ? (orgGstin.substring(0, 2) !== customerGstin.substring(0, 2)) : false,

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

        // Capture total_invoice_value from column if present
        const rowInvValue = cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0);
        if (rowInvValue > 0) {
            invoiceGroup.header.total_invoice_value = rowInvValue;
        }
    }

    // Final Pass for Sales: Ensure total_invoice_value is calculated
    for (const invGroup of invoiceMap.values()) {
        const totalTaxes = invGroup.header.total_igst + invGroup.header.total_cgst + invGroup.header.total_sgst + invGroup.header.total_cess;
        const calculatedNet = invGroup.header.total_taxable_value + totalTaxes;

        if (invGroup.header.total_invoice_value <= 0 && calculatedNet > 0) {
            invGroup.header.total_invoice_value = calculatedNet;
        }
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

const processPurchaseSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin) => {
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
        if (!invNumRaw || invNumRaw.toUpperCase().includes('TOTAL')) {
            if (i < 50) console.log(`[DEBUG] Skipping Row ${i}: No raw invoice number or TOTAL row. colMap[inv_no]=${colMap['invoice_number']} value="${invNumRaw}"`);
            continue;
        }
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) {
            if (i < 50) console.log(`[DEBUG] Skipping Row ${i}: Could not normalize invoice number: "${invNumRaw}"`);
            continue;
        }

        const supplierGstin = colMap['gstin'] !== undefined ? row[colMap['gstin']]?.toString().trim() : null;
        if (supplierGstin && !isValidGSTIN(supplierGstin)) {
            if (i < 50) console.log(`[DEBUG] Skipping Row ${i} (Inv: ${invNum}): Invalid supplier GSTIN "${supplierGstin}"`);
            continue;
        }

        const invDateRaw = row[colMap['invoice_date']];
        const invDate = parseExcelDate(invDateRaw);
        if (!invDate) {
            if (i < 50) console.log(`[DEBUG] Skipping Row ${i} (Inv: ${invNum}): Invalid/Missing Date: "${invDateRaw}" (mapped from col ${colMap['invoice_date']})`);
            continue;
        }

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
                    place_of_supply: colMap['party_state'] !== undefined ? row[colMap['party_state']]?.toString().trim() || null : (colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null),
                    round_off: cleanAmount(colMap['round_off'] !== undefined ? row[colMap['round_off']] : 0),

                    taxable_total: 0,
                    total_cgst_amount: 0,
                    total_sgst_amount: 0,
                    total_igst_amount: 0,
                    total_cess_amount: 0,
                    total_qty: 0,
                    discount: cleanAmount(colMap['discount'] !== undefined ? row[colMap['discount']] : 0),
                    net_amount: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),

                    is_interstate: colMap['inter_state'] !== undefined ? (() => { const v = row[colMap['inter_state']]?.toString().trim().toUpperCase(); return (v === 'Y' || v === 'YES' || v === '1' || v === 'TRUE') ? 'Yes' : 'No'; })() : 'No',
                    is_rcm: colMap['reverse_charge'] !== undefined ? (row[colMap['reverse_charge']]?.toString().toUpperCase().startsWith('Y')) : false,
                    status: 'DRAFT',
                    remarks: colMap['remarks'] !== undefined ? row[colMap['remarks']] : null,

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

        // Update Header Totals
        voucherGroup.header.taxable_total += taxable;
        voucherGroup.header.total_igst_amount += igst;
        voucherGroup.header.total_cgst_amount += cgst;
        voucherGroup.header.total_sgst_amount += sgst;
        voucherGroup.header.total_cess_amount += cess;
        voucherGroup.header.total_qty += cleanAmount(colMap['quantity'] !== undefined ? row[colMap['quantity']] : 0);

        // Capture net_amount from column if present and greater than 0
        const rowInvValue = cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0);
        if (rowInvValue > 0) {
            voucherGroup.header.net_amount = rowInvValue;
        }

        if (i < 5 || i % 100 === 0) console.log(`[DEBUG] Row ${i}: inv=${invNum} taxable=${taxable} igst=${igst} net=${voucherGroup.header.net_amount}`);
    }

    // Final Pass: Ensure net_amount is calculated if still 0
    for (const voucherGroup of voucherMap.values()) {
        const totalTaxes = voucherGroup.header.total_igst_amount + voucherGroup.header.total_cgst_amount + voucherGroup.header.total_sgst_amount + voucherGroup.header.total_cess_amount;
        const calculatedNet = voucherGroup.header.taxable_total + totalTaxes - (voucherGroup.header.discount || 0) + (voucherGroup.header.round_off || 0);

        if (voucherGroup.header.net_amount <= 0 && calculatedNet > 0) {
            voucherGroup.header.net_amount = calculatedNet;
            console.log(`[DEBUG] Net Amount Fallback used for ${voucherGroup.header.supplier_invoice_no}: ${calculatedNet}`);
        }
        console.log(`[DEBUG] Voucher Finalized: ${voucherGroup.header.supplier_invoice_no} net=${voucherGroup.header.net_amount}`);
    }

    return Array.from(voucherMap.values());
};

module.exports = {
    processSalesSheet,
    processPurchaseSheet
};
