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
        if (!header) return;

        // Skip reference/amendment columns — they are empty for most rows
        // and should never be mapped as primary invoice_number or invoice_date
        if (header.startsWith('REF_') || header.startsWith('REF ')) return;

        // Helper to check both "WORD WORD" and "WORD_WORD"
        const has = (str) => header.includes(str) || header.includes(str.replace(/ /g, '_'));
        const is = (str) => header === str || header === str.replace(/ /g, '_');

        // ── Customer/Supplier GSTIN ────────────────────────────────────────
        // Support both GSTIN and GSTN column variants
        if ((has('PARTY GSTIN') || has('PARTY GSTN') || has('CUSTOMER GSTIN') || has('SUPPLIER GSTIN') || is('GSTIN') || is('GSTN')) && !colMap['gstin']) {
            colMap['gstin'] = index;
        }
        // ── Party name ─────────────────────────────────────────────────────
        else if (has('PARTY NAME') || has('CUSTOMER NAME') || has('SUPPLIER NAME') || has('PARTY_NAME')) {
            colMap['party_name'] = index;
        }
        // ── Invoice / Voucher Number ────────────────────────────────────────
        // Prefer VCHR_FULL_NUMBER or INVOICE_NUMBER over plain VCHR_NO
        else if (has('VCHR FULL NUMBER') || has('VCHR_FULL_NUMBER') || has('FULL NUMBER') || has('FULL_NUMBER')) {
            colMap['invoice_number'] = index;  // full formatted number e.g. INV1
        }
        else if (!colMap['invoice_number'] && (
            has('INVOICE NUMBER') || has('VOUCHER NUMBER') || has('INV NO') || has('VCHR NO') ||
            has('INVOICE NO') || has('VOUCHER NO') || has('BILL NO') || has('BILL_NO') ||
            has('SL NO') || has('SL_NO') || has('SERIAL NO') || is('NO') || is('BILL')
        )) {
            colMap['invoice_number'] = index;
        }
        // ── Invoice Date ────────────────────────────────────────────────────
        else if (has('INVOICE DATE') || has('VOUCHER DATE') || has('INV DATE') || has('VCHR DATE') ||
            is('DATE') || is('VCHR_DATE') || is('INV_DATE')) {
            colMap['invoice_date'] = index;
        }
        // ── Invoice Value ───────────────────────────────────────────────────
        else if (has('INVOICE VALUE') || has('TOTAL VALUE') || has('NET AMOUNT') || has('INV AMT') ||
            has('VCHR AMT') || has('NET_AMT') || has('INVOICE AMOUNT') || has('VCHR_AMT') ||
            has('INVOICE AMT') || has('TOTAL AMT') || has('BILL AMOUNT') || has('TOTAL AMOUNT') ||
            has('BILL_AMT') || has('INV_AMT') || has('ROW_WISE_TOTAL_AMOUNT') || has('INVOICE_AMOUNT')) {
            colMap['invoice_value'] = index;
        }
        else if (has('PLACE OF SUPPLY') || has('POS')) colMap['place_of_supply'] = index;
        else if (has('PARTY STATE') || has('PARTY_STATE')) colMap['party_state'] = index;
        else if (has('INTER STATE') || has('INTER_STATE') || is('INTERSTATE')) colMap['inter_state'] = index;
        else if (has('ROUND OFF') || has('ROUND_OFF')) colMap['round_off'] = index;
        else if (has('REVERSE CHARGE') || has('RCM')) colMap['reverse_charge'] = index;
        else if (has('INVOICE TYPE') || has('DOCUMENT TYPE') || has('VCHR TYPE')) colMap['invoice_type'] = index;
        else if (has('BOOK TYPE')) colMap['book_type'] = index;
        else if (has('DISCOUNT')) colMap['discount'] = index;

        // ── Tax / Amount columns ────────────────────────────────────────────
        else if (has('TAXABLE VALUE') || has('TAXABLE AMOUNT') || has('TAXABLE AMT') ||
            has('TAXABLE_AMT') || has('TOTAL TAXABLE AMOUNT') || has('TOTAL_TAXABLE_AMOUNT')) {
            colMap['taxable_value'] = index;
        }
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
        else if (has('ITC ELIGIBLE')) colMap['itc_eligible'] = index;
        else if (has('ITC CLAIMED')) colMap['itc_claimed'] = index;
    });

    console.log('[DEBUG] Calculated colMap:', JSON.stringify(colMap));
    return colMap;
};


/**
 * Maps raw CSV vchr_type / book_type codes to the DB invoice_type constraint values.
 * DB allows: 'B2B','B2C_SMALL','B2C_LARGE','EXPORT','SEZ','DEBIT_NOTE','CREDIT_NOTE'
 *
 * @param {string} rawType  - vchr_type from CSV (SA, SR, CN, DN, etc.)
 * @param {string} custGstin - customer GSTIN (null/empty for B2C)
 * @returns {string}
 */
const resolveInvoiceType = (rawType, custGstin) => {
    const t = (rawType || '').toString().toUpperCase().trim();
    if (t === 'CN') return 'CREDIT_NOTE';
    if (t === 'DN') return 'DEBIT_NOTE';
    if (t === 'EXPORT') return 'EXPORT';
    if (t === 'SEZ') return 'SEZ';
    // SA = standard sale, SR = sales return — determine B2B vs B2C by GSTIN presence
    if (custGstin && isValidGSTIN(custGstin)) return 'B2B';
    return 'B2C_SMALL';
};

const processSalesSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin) => {

    // ── 1. Find the header row ─────────────────────────────────────────────
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const rowStr = (rows[i] || []).join(' ').toUpperCase();
        if (rowStr.includes('VCHR') || rowStr.includes('INVOICE') || rowStr.includes('ORG_GSTIN')) {
            headerRowIndex = i;
            break;
        }
    }
    if (headerRowIndex === -1) {
        console.log('[processSalesSheet] ERROR: header row not found');
        return [];
    }

    const headerRow = rows[headerRowIndex];

    // ── 2. Build a name→index map from actual header strings ───────────────
    const col = {};
    headerRow.forEach((cell, idx) => {
        const h = (cell || '').toString().toLowerCase().trim().replace(/\s+/g, '_');
        col[h] = idx;
    });
    console.log('[processSalesSheet] Columns detected:', JSON.stringify(col));

    // ── 3. Identify the key column indices for this CSV format ────────────
    // Invoice number: prefer vchr_full_number (e.g. INV1), fallback vchr_no
    const invNumIdx = col['vchr_full_number'] ?? col['vchr_no'] ?? col['invoice_number'] ?? col['invoice_no'] ?? null;
    // Invoice date: vchr_date
    const invDateIdx = col['vchr_date'] ?? col['invoice_date'] ?? col['date'] ?? null;
    // vchr_type: SA/SR/CN/DN — used to derive invoice_type
    const vTypeIdx = col['vchr_type'] ?? col['invoice_type'] ?? col['document_type'] ?? null;
    // Party
    const partyIdx = col['party_name'] ?? col['customer_name'] ?? col['supplier_name'] ?? null;
    const gstinIdx = col['party_gstn_no'] ?? col['party_gstin'] ?? col['customer_gstin'] ?? col['gstin'] ?? null;
    const stateIdx = col['party_state'] ?? null;
    const interIdx = col['inter_state'] ?? col['interstate'] ?? null;
    const rcIdx = col['reverse_charge'] ?? null;
    const posIdx = col['party_state'] ?? null;  // use party_state as place_of_supply if no explicit POS column
    // Amounts
    const taxableIdx = col['total_taxable_amount'] ?? col['taxable_value'] ?? col['taxable_amount'] ?? null;
    const igstIdx = col['total_igst_tax_amount'] ?? col['igst_amount'] ?? col['igst'] ?? null;
    const sgstIdx = col['total_sgst_tax_amount'] ?? col['sgst_amount'] ?? col['sgst'] ?? null;
    const cgstIdx = col['total_cgst_tax_amount'] ?? col['cgst_amount'] ?? col['cgst'] ?? null;
    const cessIdx = col['total_cess_tax_amount'] ?? col['cess_amount'] ?? col['cess'] ?? null;
    const invValueIdx = col['invoice_amount'] ?? col['row_wise_total_amount'] ?? col['invoice_value'] ?? col['total_value'] ?? null;
    const roundOffIdx = col['round_off_amount'] ?? col['round_off'] ?? null;

    if (invNumIdx === null || invDateIdx === null) {
        console.log('[processSalesSheet] ERROR: cannot find invoice_number or invoice_date columns');
        return [];
    }

    // ── 4. Parse date: supports DD-MM-YY, DD-MM-YYYY, YYYY-MM-DD, Excel serial ──
    const parseDate = (val) => {
        if (!val && val !== 0) return null;
        // Excel serial number
        if (typeof val === 'number') return parseExcelDate(val);
        const s = val.toString().trim();
        if (!s) return null;
        // Try DD-MM-YY or DD-MM-YYYY
        const ddmmyy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})$/);
        if (ddmmyy) {
            let [, dd, mm, yy] = ddmmyy;
            if (yy.length === 2) yy = parseInt(yy) >= 50 ? `19${yy}` : `20${yy}`;
            return `${yy}-${mm}-${dd}`;
        }
        // Try YYYY-MM-DD
        const yyyymmdd = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
        if (yyyymmdd) return s.replace(/\//g, '-');
        return parseExcelDate(val);
    };

    // ── 5. Process data rows ───────────────────────────────────────────────
    // The CSV has MULTIPLE rows per invoice (one per HSN/tax rate).
    // Group by vchr_full_number + vchr_date and SUM the tax amounts.
    const invoiceMap = new Map();
    const dataStart = headerRowIndex + 1;

    for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        const invNumRaw = (row[invNumIdx] ?? '').toString().trim();
        if (!invNumRaw || invNumRaw.toUpperCase().includes('TOTAL') || invNumRaw.toUpperCase() === 'VCHR_FULL_NUMBER') continue;
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) continue;

        const invDate = parseDate(row[invDateIdx]);
        if (!invDate) continue;

        const groupKey = `${invNum}__${invDate}`;

        const custGstin = gstinIdx !== null ? (row[gstinIdx] ?? '').toString().trim() || null : null;
        const custGstinClean = custGstin && isValidGSTIN(custGstin) ? custGstin : null;

        const vchType = vTypeIdx !== null ? (row[vTypeIdx] ?? '').toString().trim() : 'SA';
        // Map vchr_type to book_type (for DB column)
        const bookType = (() => {
            const t = vchType.toUpperCase();
            if (t === 'CN' || t === 'CREDIT NOTE') return 'CN';
            if (t === 'DN' || t === 'DEBIT NOTE') return 'DN';
            if (t === 'SR' || t === 'SALES RETURN') return 'SR';
            return 'SA'; // default Sales
        })();

        const invType = resolveInvoiceType(vchType, custGstinClean);

        const taxable = cleanAmount(taxableIdx !== null ? row[taxableIdx] : 0);
        const igst = cleanAmount(igstIdx !== null ? row[igstIdx] : 0);
        const sgst = cleanAmount(sgstIdx !== null ? row[sgstIdx] : 0);
        const cgst = cleanAmount(cgstIdx !== null ? row[cgstIdx] : 0);
        const cess = cleanAmount(cessIdx !== null ? row[cessIdx] : 0);
        const rowTotal = cleanAmount(invValueIdx !== null ? row[invValueIdx] : 0);

        if (!invoiceMap.has(groupKey)) {
            const partyState = stateIdx !== null ? (row[stateIdx] ?? '').toString().trim() || null : null;
            const pos = posIdx !== null ? partyState : (custGstinClean ? custGstinClean.substring(0, 2) : null);
            const isInter = interIdx !== null
                ? (row[interIdx] ?? '').toString().toUpperCase().startsWith('Y')
                : (orgGstin && custGstinClean ? orgGstin.substring(0, 2) !== custGstinClean.substring(0, 2) : false);
            const rc = rcIdx !== null ? (row[rcIdx] ?? '').toString().toUpperCase().startsWith('Y') : false;

            invoiceMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId || null,
                    invoice_type: invType,
                    book_type: bookType,
                    invoice_number: invNum,
                    invoice_date: invDate,
                    customer_name: partyIdx !== null ? (row[partyIdx] ?? '').toString().trim() || null : null,
                    customer_gstin: custGstinClean,
                    place_of_supply: pos ? pos.toString() : null,
                    is_interstate: isInter,
                    reverse_charge: rc,
                    total_taxable_value: 0,
                    total_igst: 0,
                    total_cgst: 0,
                    total_sgst: 0,
                    total_cess: 0,
                    total_invoice_value: 0,
                    filing_period: returnPeriod || null,
                },
                items: []
            });
        }

        const inv = invoiceMap.get(groupKey);
        // Aggregate tax amounts across multiple rows (multi-HSN invoices)
        inv.header.total_taxable_value += taxable;
        inv.header.total_igst += igst;
        inv.header.total_cgst += cgst;
        inv.header.total_sgst += sgst;
        inv.header.total_cess += cess;
        // Use the largest row_wise_total as invoice_amount (last writer wins if multiple exact rows)
        if (rowTotal > 0) inv.header.total_invoice_value = rowTotal;

        // Line item
        inv.items.push({
            hsn_sac_code: null,
            description: null,
            quantity: 0,
            uom: null,
            unit_rate: 0,
            taxable_value: taxable,
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: taxable + igst + cgst + sgst + cess
        });
    }

    // Recalculate total_invoice_value from sum if not set from column
    for (const inv of invoiceMap.values()) {
        if (!inv.header.total_invoice_value || inv.header.total_invoice_value <= 0) {
            inv.header.total_invoice_value =
                inv.header.total_taxable_value +
                inv.header.total_igst + inv.header.total_cgst +
                inv.header.total_sgst + inv.header.total_cess;
        }
        // Round to 2dp
        for (const k of ['total_taxable_value', 'total_igst', 'total_cgst', 'total_sgst', 'total_cess', 'total_invoice_value']) {
            inv.header[k] = Math.round(inv.header[k] * 100) / 100;
        }
    }

    const result = Array.from(invoiceMap.values());
    console.log(`[processSalesSheet] Processed ${result.length} unique invoices from ${rows.length - dataStart} data rows`);
    return result;
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
