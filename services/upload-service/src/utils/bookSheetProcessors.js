const { isValidGSTIN, normalizeInvoiceNumber, parseExcelDate, cleanAmount } = require('./validation');

/**
 * Book Data Sheet Processors
 * Maps Sales/Purchase Register CSV columns to Database Schema.
 *
 * Both Sales and Purchase CSVs use the SAME column layout:
 *   Org_gstin, vchr_id, vchr_type, vchr_prefix, vchr_no, vchr_date,
 *   vchr_full_number, ref_vchr_no, ref_vchr_date, ref_vchr_full_number,
 *   party_name, party_gstn_no, party_state, reverse_charge, inter_state,
 *   gstr_category, filing_period, is_amendment, tax_per,
 *   total_taxable_amount, total_igst_tax_amount, total_sgst_tax_amount,
 *   total_cgst_tax_amount, total_cess_tax_amount,
 *   row_wise_total_amount, round_off_amount, invoice_amount
 *
 * vchr_type values per register:
 *   Sales file:    SA (invoice), SR (sales return), CN (credit note), DN (debit note)
 *   Purchase file: PA (invoice), EXP (expense),    DN (debit note),  CN (credit note)
 *
 * The SAME vchr_type code (CN/DN) means different things depending on the upload context:
 *   - Uploaded as SALES   → goes to sales_invoices   → invoice_type = CREDIT_NOTE / DEBIT_NOTE
 *   - Uploaded as PURCHASE → goes to purchase_vouchers → voucher_type = CREDIT_NOTE / DEBIT_NOTE
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared date parser — handles DD-MM-YY, DD-MM-YYYY, YYYY-MM-DD, Excel serials
// ─────────────────────────────────────────────────────────────────────────────
const parseDate = (val) => {
    if (!val && val !== 0) return null;
    const s = val.toString().trim();
    if (!s || s === '0000-00-00' || s === '""') return null;

    if (typeof val === 'number') return parseExcelDate(val);

    // Matches DD-MM-YY, DD-MM-YYYY, MM-DD-YY, MM-DD-YYYY separated by / or -
    const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dm) {
        let [, p1, p2, yy] = dm;
        let mm, dd;

        // CSV exported from Tally/Indian ERPs vs American Excel formats
        if (parseInt(p2, 10) > 12) {
            // e.g. 04-30-25 -> month 4, day 30
            mm = p1; dd = p2;
        } else if (parseInt(p1, 10) > 12) {
            // e.g. 13-04-25 -> day 13, month 4
            dd = p1; mm = p2;
        } else {
            // Ambiguous (e.g. 04-01-25)
            // Typically in this user's CSV data, it uses MM-DD-YY
            mm = p1; dd = p2;
        }

        dd = dd.padStart(2, '0');
        mm = mm.padStart(2, '0');
        if (yy.length === 2) yy = parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`;
        return `${yy}-${mm}-${dd}`;
    }

    // YYYY-MM-DD  /  YYYY/MM/DD
    const ym = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (ym) {
        const clean = s.replace(/\//g, '-');
        if (clean === '0000-00-00') return null;
        return clean;
    }

    return parseExcelDate(val); // last-resort for Excel serial numbers
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales-specific type resolvers
// ─────────────────────────────────────────────────────────────────────────────

/** invoice_type stored in sales_invoices */
const resolveSalesInvoiceType = (vchType, custGstin) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'CN') return 'CREDIT_NOTE';
    if (t === 'DN') return 'DEBIT_NOTE';
    if (t === 'EXPORT') return 'EXPORT';
    if (t === 'SEZ') return 'SEZ';
    // SA / SR — B2B if counterparty has valid GSTIN, otherwise B2C
    return (custGstin && isValidGSTIN(custGstin)) ? 'B2B' : 'B2C_SMALL';
};

/** book_type stored in sales_invoices (SA / SR / CN / DN) */
const resolveSalesBookType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'SR') return 'SR';
    if (t === 'CN') return 'CN';
    if (t === 'DN') return 'DN';
    return 'SA';
};

// ─────────────────────────────────────────────────────────────────────────────
// Purchase-specific type resolvers
// ─────────────────────────────────────────────────────────────────────────────

/** voucher_type stored in purchase_vouchers (PURCHASE / EXPENSE / DEBIT_NOTE / CREDIT_NOTE) */
const resolvePurchaseVoucherType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'EXP' || t === 'EXPENSE') return 'EXPENSE';
    if (t === 'DN' || t === 'DEBIT_NOTE' || t === 'DEBIT NOTE') return 'DEBIT_NOTE';
    if (t === 'CN' || t === 'CREDIT_NOTE' || t === 'CREDIT NOTE') return 'CREDIT_NOTE';
    return 'PURCHASE'; // PA and anything else
};

/** book_type stored in purchase_vouchers (PA / EXP / DN / CN) */
const resolvePurchaseBookType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'EXP' || t === 'EXPENSE') return 'EXP';
    if (t === 'DN' || t === 'DEBIT_NOTE' || t === 'DEBIT NOTE') return 'DN';
    if (t === 'CN' || t === 'CREDIT_NOTE' || t === 'CREDIT NOTE') return 'CN';
    return 'PA';
};

// ─────────────────────────────────────────────────────────────────────────────
// Build a lowercase_underscore → column_index map from a header row
// ─────────────────────────────────────────────────────────────────────────────
const buildColMap = (headerRow) => {
    const col = {};
    headerRow.forEach((cell, idx) => {
        const h = (cell || '').toString().toLowerCase().trim().replace(/\s+/g, '_');
        if (h) col[h] = idx;
    });
    return col;
};

// ─────────────────────────────────────────────────────────────────────────────
// processSalesSheet
// Routes each row into sales_invoices based on vchr_type: SA, SR, CN, DN
// ─────────────────────────────────────────────────────────────────────────────
const processSalesSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin, uploadType = 'SALES') => {

    // 1. Locate header row
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

    const col = buildColMap(rows[headerRowIndex]);
    console.log('[processSalesSheet] Columns:', JSON.stringify(col));

    // 2. Column index lookups
    const invNumIdx = col['vchr_full_number'] ?? col['vchr_no'] ?? col['invoice_number'] ?? col['invoice_no'] ?? null;
    const invDateIdx = col['vchr_date'] ?? col['invoice_date'] ?? col['date'] ?? null;
    const vTypeIdx = col['vchr_type'] ?? col['invoice_type'] ?? col['document_type'] ?? null;
    const partyIdx = col['party_name'] ?? col['customer_name'] ?? col['supplier_name'] ?? null;
    const gstinIdx = col['party_gstn_no'] ?? col['party_gstin'] ?? col['customer_gstin'] ?? col['gstin'] ?? null;
    const stateIdx = col['party_state'] ?? null;
    const interIdx = col['inter_state'] ?? col['interstate'] ?? null;
    const rcIdx = col['reverse_charge'] ?? null;
    const taxableIdx = col['total_taxable_amount'] ?? col['taxable_value'] ?? col['taxable_amount'] ?? null;
    const igstIdx = col['total_igst_tax_amount'] ?? col['igst_amount'] ?? col['igst'] ?? null;
    const sgstIdx = col['total_sgst_tax_amount'] ?? col['sgst_amount'] ?? col['sgst'] ?? null;
    const cgstIdx = col['total_cgst_tax_amount'] ?? col['cgst_amount'] ?? col['cgst'] ?? null;
    const cessIdx = col['total_cess_tax_amount'] ?? col['cess_amount'] ?? col['cess'] ?? null;
    // For overall invoice value. (Note: in SS file, 'row_wise_total_amount' is the item total, not the invoice total, but we check 'invoice_amount' first)
    const invValIdx = col['invoice_amount'] ?? col['invoice_value'] ?? col['total_value'] ?? null;

    // New fields
    const isAmendmentIdx = col['is_amendment'] ?? null;
    const roundOffIdx = col['round_off_amount'] ?? col['round_off'] ?? null;
    const descIdx = col['description'] ?? null;
    const taxPerIdx = col['tax_per'] ?? col['tax_rate'] ?? col['gst_rate'] ?? null;
    const itemTotalIdx = col['row_wise_total_amount'] ?? col['total_amount_with_tax'] ?? null;
    
    // Additional Amendment Fields
    const origInvNoIdx = col['original_invoice_no'] ?? col['original_supplier_invoice_no'] ?? null;
    const origInvDateIdx = col['original_invoice_date'] ?? col['original_supplier_invoice_date'] ?? null;
    const origVchrNoIdx = col['original_book_vchr_no'] ?? null;
    const origVchrDateIdx = col['original_book_vchr_date'] ?? null;
    const origNetAmtIdx = col['original_net_amount'] ?? null;
    const returnDateIdx = col['return_date'] ?? null;
    const origReturnPeriodIdx = col['original_return_period'] ?? null;
    const origReturnDateIdx = col['original_return_date'] ?? null;

    // Original Item Fields
    const origTaxableIdx = col['original_taxable_amount'] ?? col['original_taxable_value'] ?? null;
    const origIgstIdx = col['original_igst_amount'] ?? null;
    const origCgstIdx = col['original_cgst_amount'] ?? null;
    const origSgstIdx = col['original_sgst_amount'] ?? null;
    const origCessIdx = col['original_cess_amount'] ?? null;
    const origTaxPerIdx = col['original_tax_per'] ?? col['original_gst_rate_percent'] ?? null;

    if (invNumIdx === null || invDateIdx === null) {
        console.log('[processSalesSheet] ERROR: missing invoice_number or date column');
        return [];
    }

    // 3. Process rows — group multi-HSN lines by invoice key
    const invoiceMap = new Map();
    const dataStart = headerRowIndex + 1;

    for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        const invNumRaw = (row[invNumIdx] ?? '').toString().trim();
        if (!invNumRaw || invNumRaw.toUpperCase().includes('TOTAL')) continue;
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) continue;

        const invDate = parseDate(row[invDateIdx]);
        if (!invDate) continue;

        const groupKey = `${invNum}__${invDate}`;

        const custGstinRaw = gstinIdx !== null ? (row[gstinIdx] ?? '').toString().trim() : '';
        const custGstinClean = (custGstinRaw && isValidGSTIN(custGstinRaw)) ? custGstinRaw : null;

        const vchType = vTypeIdx !== null ? (row[vTypeIdx] ?? '').toString().trim() : 'SA';
        const bookType = resolveSalesBookType(vchType);
        const invType = resolveSalesInvoiceType(vchType, custGstinClean);

        const taxable = cleanAmount(taxableIdx !== null ? row[taxableIdx] : 0);
        const igst = cleanAmount(igstIdx !== null ? row[igstIdx] : 0);
        const sgst = cleanAmount(sgstIdx !== null ? row[sgstIdx] : 0);
        const cgst = cleanAmount(cgstIdx !== null ? row[cgstIdx] : 0);
        const cess = cleanAmount(cessIdx !== null ? row[cessIdx] : 0);
        const rowVal = cleanAmount(invValIdx !== null ? row[invValIdx] : 0);

        const isAmendment = isAmendmentIdx !== null ? (row[isAmendmentIdx] ?? '').toString().toUpperCase().startsWith('Y') : false;
        const roundOff = cleanAmount(roundOffIdx !== null ? row[roundOffIdx] : 0);
        const description = descIdx !== null ? (row[descIdx] ?? '').toString().trim() || null : null;
        const taxRateStr = taxPerIdx !== null ? (row[taxPerIdx] ?? '').toString().replace(/%/g, '').trim() : '';
        const taxRate = taxRateStr ? parseFloat(taxRateStr) : null;
        let itemTotal = itemTotalIdx !== null ? cleanAmount(row[itemTotalIdx]) : 0;
        if (itemTotal === 0 && (taxable || igst || cgst || sgst || cess)) {
            itemTotal = taxable + igst + cgst + sgst + cess;
        }

        if (!invoiceMap.has(groupKey)) {
            const partyState = stateIdx !== null ? (row[stateIdx] ?? '').toString().trim() || null : null;
            const pos = partyState || (custGstinClean ? custGstinClean.substring(0, 2) : null);
            const isInter = interIdx !== null
                ? (row[interIdx] ?? '').toString().toUpperCase().startsWith('Y')
                : (orgGstin && custGstinClean ? orgGstin.substring(0, 2) !== custGstinClean.substring(0, 2) : false);
            const rc = rcIdx !== null ? (row[rcIdx] ?? '').toString().toUpperCase().startsWith('Y') : false;

            // Derive filing_period (MMYYYY) from invDate (YYYY-MM-DD)
            const dateParts = invDate.split('-');
            const derivedFilingPeriod = dateParts.length === 3 ? `${dateParts[1]}${dateParts[0]}` : (returnPeriod || null);

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
                    is_amendment: isAmendment,
                    round_off: 0,
                    total_taxable_value: 0,
                    total_igst: 0,
                    total_cgst: 0,
                    total_sgst: 0,
                    total_cess: 0,
                    total_invoice_value: 0,
                    filing_period: derivedFilingPeriod,
                    return_period: derivedFilingPeriod,
                    original_invoice_no: origInvNoIdx !== null ? (row[origInvNoIdx] ?? '').toString().trim() : null,
                    original_invoice_date: origInvDateIdx !== null ? parseDate(row[origInvDateIdx]) : null,
                    original_book_vchr_no: origVchrNoIdx !== null ? (row[origVchrNoIdx] ?? '').toString().trim() : null,
                    original_book_vchr_date: origVchrDateIdx !== null ? parseDate(row[origVchrDateIdx]) : null,
                    original_net_amount: origNetAmtIdx !== null ? cleanAmount(row[origNetAmtIdx]) : 0,
                    return_date: returnDateIdx !== null ? parseDate(row[returnDateIdx]) : null,
                    original_return_period: origReturnPeriodIdx !== null ? (row[origReturnPeriodIdx] ?? '').toString().trim() : null,
                    original_return_date: origReturnDateIdx !== null ? parseDate(row[origReturnDateIdx]) : null,
                },
                items: []
            });
        }

        const inv = invoiceMap.get(groupKey);
        inv.header.total_taxable_value += taxable;
        inv.header.total_igst += igst;
        inv.header.total_cgst += cgst;
        inv.header.total_sgst += sgst;
        inv.header.total_cess += cess;
        if (rowVal > 0) inv.header.total_invoice_value = rowVal;
        if (roundOff !== 0) inv.header.round_off = roundOff;

        inv.items.push({
            hsn_sac_code: null,
            description: description,
            quantity: 0,
            uom: null,
            unit_rate: 0,
            taxable_value: taxable,
            gst_rate_percent: taxRate,
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: itemTotal,
            original_taxable_value: origTaxableIdx !== null ? cleanAmount(row[origTaxableIdx]) : 0,
            original_igst_amount: origIgstIdx !== null ? cleanAmount(row[origIgstIdx]) : 0,
            original_cgst_amount: origCgstIdx !== null ? cleanAmount(row[origCgstIdx]) : 0,
            original_sgst_amount: origSgstIdx !== null ? cleanAmount(row[origSgstIdx]) : 0,
            original_cess_amount: origCessIdx !== null ? cleanAmount(row[origCessIdx]) : 0,
            original_gst_rate_percent: origTaxPerIdx !== null ? parseFloat(row[origTaxPerIdx]) || 0 : 0
        });
    }

    // Round and fallback totals
    for (const inv of invoiceMap.values()) {
        if (!inv.header.total_invoice_value || inv.header.total_invoice_value <= 0) {
            inv.header.total_invoice_value =
                inv.header.total_taxable_value + inv.header.total_igst +
                inv.header.total_cgst + inv.header.total_sgst + inv.header.total_cess;
        }
        for (const k of ['total_taxable_value', 'total_igst', 'total_cgst', 'total_sgst', 'total_cess', 'total_invoice_value']) {
            inv.header[k] = Math.round(inv.header[k] * 100) / 100;
        }
    }

    const result = Array.from(invoiceMap.values());
    console.log(`[processSalesSheet] ${result.length} unique invoices from ${rows.length - dataStart} data rows`);
    return result;
};


// ─────────────────────────────────────────────────────────────────────────────
// processPurchaseSheet
// Routes each row into purchase_vouchers based on vchr_type: PA, EXP, DN, CN
//
// KEY FIX: Uses parseDate() (not parseExcelDate()) so "04-01-25" strings work.
// ─────────────────────────────────────────────────────────────────────────────
const processPurchaseSheet = (rows, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin, uploadType = 'PURCHASE') => {

    // 1. Locate header row
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const rowStr = (rows[i] || []).join(' ').toUpperCase();
        if (rowStr.includes('VCHR') || rowStr.includes('INVOICE') || rowStr.includes('ORG_GSTIN')) {
            headerRowIndex = i;
            break;
        }
    }
    if (headerRowIndex === -1) {
        console.log('[processPurchaseSheet] ERROR: header row not found');
        return [];
    }

    const col = buildColMap(rows[headerRowIndex]);
    console.log('[processPurchaseSheet] Columns:', JSON.stringify(col));

    // 2. Column index lookups (mirrors processSalesSheet, just different field aliases)
    const invNumIdx = col['vchr_full_number'] ?? col['vchr_no'] ?? col['invoice_number'] ?? col['invoice_no'] ?? null;
    const invDateIdx = col['vchr_date'] ?? col['invoice_date'] ?? col['date'] ?? null;
    const refNumIdx = col['ref_vchr_full_number'] ?? col['ref_vchr_no'] ?? null;
    const refDateIdx = col['ref_vchr_date'] ?? null;
    
    const vTypeIdx = col['vchr_type'] ?? col['invoice_type'] ?? col['document_type'] ?? null;
    const partyIdx = col['party_name'] ?? col['supplier_name'] ?? col['customer_name'] ?? null;
    // party_gstn_no is what this specific CSV uses; fall back to generic names
    const gstinIdx = col['party_gstn_no'] ?? col['party_gstin'] ?? col['supplier_gstin'] ?? col['gstin'] ?? null;
    const stateIdx = col['party_state'] ?? null;
    const interIdx = col['inter_state'] ?? col['interstate'] ?? null;
    const rcIdx = col['reverse_charge'] ?? null;
    const roundOffIdx = col['round_off_amount'] ?? col['round_off'] ?? null;
    const taxableIdx = col['total_taxable_amount'] ?? col['taxable_value'] ?? col['taxable_amount'] ?? null;
    const igstIdx = col['total_igst_tax_amount'] ?? col['igst_amount'] ?? col['igst'] ?? null;
    const sgstIdx = col['total_sgst_tax_amount'] ?? col['sgst_amount'] ?? col['sgst'] ?? null;
    const cgstIdx = col['total_cgst_tax_amount'] ?? col['cgst_amount'] ?? col['cgst'] ?? null;
    const cessIdx = col['total_cess_tax_amount'] ?? col['cess_amount'] ?? col['cess'] ?? null;
    const invValIdx = col['invoice_amount'] ?? col['invoice_value'] ?? col['total_value'] ?? null;
    const rowInvValIdx = col['row_wise_total_amount'] ?? null;

    // Item Specific
    const descIdx = col['description'] ?? col['item_desc'] ?? null;
    const taxPerIdx = col['tax_per'] ?? col['gst_rate'] ?? col['tax_rate'] ?? null;

    // Amendment / Original Fields
    const isAmendmentIdx = col['is_amendment'] ?? null;
    const origInvNoIdx = col['original_supplier_invoice_no'] ?? null;
    const origInvDateIdx = col['original_supplier_invoice_date'] ?? null;
    const origVchrNoIdx = col['original_book_vchr_no'] ?? null;
    const origVchrDateIdx = col['original_book_vchr_date'] ?? null;
    const origNetAmtIdx = col['original_net_amount'] ?? null;
    const returnDateIdx = col['return_date'] ?? null;
    const origReturnPeriodIdx = col['original_return_period'] ?? null;
    const origReturnDateIdx = col['original_return_date'] ?? null;
    
    // Original Item Fields
    const origTaxableIdx = col['original_taxable_amount'] ?? null;
    const origIgstIdx = col['original_igst_amount'] ?? null;
    const origCgstIdx = col['original_cgst_amount'] ?? null;
    const origSgstIdx = col['original_sgst_amount'] ?? null;
    const origCessIdx = col['original_cess_amount'] ?? null;
    const origTaxPerIdx = col['original_tax_per'] ?? null;

    if (invNumIdx === null || invDateIdx === null) {
        console.log('[processPurchaseSheet] ERROR: missing invoice_number or date column');
        return [];
    }

    // 3. Process rows — group multi-HSN lines by invoice key
    const voucherMap = new Map();
    const dataStart = headerRowIndex + 1;

    for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        // Resolve internal BOOK Voucher details
        const bookVchrNoRaw = (row[invNumIdx] ?? '').toString().trim();
        const bookVchrNo = normalizeInvoiceNumber(bookVchrNoRaw);
        const bookVchrDate = parseDate(row[invDateIdx]);
        
        if (!bookVchrNo || !bookVchrDate) continue;

        // Resolve SUPPLIER Invoice details (Mapping provided by user)
        // ref_vchr_full_number -> supplier_invoice_no
        // ref_vchr_date        -> supplier_invoice_date
        let supplierInvoiceNo = null;
        if (refNumIdx !== null) {
            const refNumRaw = (row[refNumIdx] ?? '').toString().trim();
            supplierInvoiceNo = normalizeInvoiceNumber(refNumRaw);
        }
        
        let supplierInvoiceDate = null;
        if (refDateIdx !== null) {
            supplierInvoiceDate = parseDate(row[refDateIdx]);
        }
        
        // Fallback: If reference fields are empty, use book voucher values
        if (!supplierInvoiceNo) supplierInvoiceNo = bookVchrNo;
        if (!supplierInvoiceDate) supplierInvoiceDate = bookVchrDate;

        // GSTIN: allow empty (unregistered/exempt vendors).
        // Only reject a NON-EMPTY GSTIN that is clearly malformed.
        const gstinRaw = gstinIdx !== null ? (row[gstinIdx] ?? '').toString().trim() : '';
        const supplierGstin = gstinRaw || null;                // null if blank
        const supplierGstinClean = (supplierGstin && isValidGSTIN(supplierGstin)) ? supplierGstin : null;
        // (We keep the row even if GSTIN is present but invalid — just don't store the bad value)

        // vchr_type → voucher_type + book_type
        const vchType = vTypeIdx !== null ? (row[vTypeIdx] ?? '').toString().trim() : 'PA';
        const voucherType = resolvePurchaseVoucherType(vchType);
        const bookType = resolvePurchaseBookType(vchType);

        // Amounts
        const taxable = cleanAmount(taxableIdx !== null ? row[taxableIdx] : 0);
        const igst = cleanAmount(igstIdx !== null ? row[igstIdx] : 0);
        const sgst = cleanAmount(sgstIdx !== null ? row[sgstIdx] : 0);
        const cgst = cleanAmount(cgstIdx !== null ? row[cgstIdx] : 0);
        const cess = cleanAmount(cessIdx !== null ? row[cessIdx] : 0);
        const rowVal = cleanAmount(invValIdx !== null ? row[invValIdx] : 0);
        const itemTotal = cleanAmount(rowInvValIdx !== null ? row[rowInvValIdx] : (taxable + igst + cgst + sgst + cess));
        const roundOff = cleanAmount(roundOffIdx !== null ? row[roundOffIdx] : 0);

        const description = descIdx !== null ? (row[descIdx] ?? '').toString().trim() : null;
        let taxRate = 0;
        if (taxPerIdx !== null) {
            taxRate = parseFloat(row[taxPerIdx]);
            if (isNaN(taxRate)) taxRate = 0;
        }

        const groupKey = `${bookVchrNo}__${bookVchrDate}`;

        if (!voucherMap.has(groupKey)) {
            const partyState = stateIdx !== null ? (row[stateIdx] ?? '').toString().trim() || null : null;
            const pos = partyState || (supplierGstinClean ? supplierGstinClean.substring(0, 2) : null);
            const isInter = interIdx !== null
                ? (row[interIdx] ?? '').toString().toUpperCase().startsWith('Y')
                : (orgGstin && supplierGstinClean ? orgGstin.substring(0, 2) !== supplierGstinClean.substring(0, 2) : false);
            const rc = rcIdx !== null ? (row[rcIdx] ?? '').toString().toUpperCase().startsWith('Y') : false;

            // Derive filing_period (MMYYYY) from invDate (YYYY-MM-DD)
            const dateParts = bookVchrDate.split('-');
            const derivedFilingPeriod = dateParts.length === 3 ? `${dateParts[1]}${dateParts[0]}` : (returnPeriod || null);

            voucherMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId || null,
                    voucher_type: voucherType,
                    book_type: bookType,
                    book_vchr_no: bookVchrNo,
                    book_vchr_date: bookVchrDate,
                    supplier_invoice_no: supplierInvoiceNo,
                    supplier_invoice_date: supplierInvoiceDate,
                    supplier_name: partyIdx !== null ? (row[partyIdx] ?? '').toString().trim() || null : null,
                    supplier_gstin: supplierGstinClean,
                    place_of_supply: pos ? pos.toString() : null,
                    is_interstate: isInter ? 'Yes' : 'No',
                    is_rcm: rc,
                    round_off: roundOff,
                    status: 'DRAFT',
                    remarks: null,
                    total_qty: 0,
                    discount: 0,
                    taxable_total: 0,
                    total_igst_amount: 0,
                    total_cgst_amount: 0,
                    total_sgst_amount: 0,
                    total_cess_amount: 0,
                    net_amount: 0,
                    itc_eligible: true,
                    itc_claimed: false,
                    filing_period: derivedFilingPeriod,
                    return_period: derivedFilingPeriod,
                    is_amendment: isAmendmentIdx !== null ? (row[isAmendmentIdx] ?? '').toString().toUpperCase().startsWith('Y') : false,
                    original_supplier_invoice_no: origInvNoIdx !== null ? (row[origInvNoIdx] ?? '').toString().trim() : null,
                    original_supplier_invoice_date: origInvDateIdx !== null ? parseDate(row[origInvDateIdx]) : null,
                    original_book_vchr_no: origVchrNoIdx !== null ? (row[origVchrNoIdx] ?? '').toString().trim() : null,
                    original_book_vchr_date: origVchrDateIdx !== null ? parseDate(row[origVchrDateIdx]) : null,
                    original_net_amount: origNetAmtIdx !== null ? cleanAmount(row[origNetAmtIdx]) : 0,
                    return_date: returnDateIdx !== null ? parseDate(row[returnDateIdx]) : null,
                    original_return_period: origReturnPeriodIdx !== null ? (row[origReturnPeriodIdx] ?? '').toString().trim() : null,
                    original_return_date: origReturnDateIdx !== null ? parseDate(row[origReturnDateIdx]) : null,
                },
                items: []
            });
        }

        const v = voucherMap.get(groupKey);
        v.header.taxable_total += taxable;
        v.header.total_igst_amount += igst;
        v.header.total_cgst_amount += cgst;
        v.header.total_sgst_amount += sgst;
        v.header.total_cess_amount += cess;
        if (rowVal > 0) v.header.net_amount = rowVal;
        if (roundOff !== 0) v.header.round_off = roundOff;

        v.items.push({
            hsn_code: null,
            description: description,
            quantity: 0,
            uom: null,
            unit_rate: 0,
            taxable_amount: taxable,
            tax_per: taxRate,
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: itemTotal,
            original_taxable_amount: origTaxableIdx !== null ? cleanAmount(row[origTaxableIdx]) : 0,
            original_igst_amount: origIgstIdx !== null ? cleanAmount(row[origIgstIdx]) : 0,
            original_cgst_amount: origCgstIdx !== null ? cleanAmount(row[origCgstIdx]) : 0,
            original_sgst_amount: origSgstIdx !== null ? cleanAmount(row[origSgstIdx]) : 0,
            original_cess_amount: origCessIdx !== null ? cleanAmount(row[origCessIdx]) : 0,
            original_tax_per: origTaxPerIdx !== null ? parseFloat(row[origTaxPerIdx]) || 0 : 0
        });

        // VALIDATION LOGIC FOR AMENDMENTS
        const header = v.header;
        if (header.is_amendment) {
            const hasOrigDate = header.original_supplier_invoice_date || header.original_book_vchr_date;
            if (hasOrigDate) {
                const voucherDate = new Date(header.book_vchr_date);
                const origSuppDate = header.original_supplier_invoice_date ? new Date(header.original_supplier_invoice_date) : null;
                const origBookDate = header.original_book_vchr_date ? new Date(header.original_book_vchr_date) : null;

                const isSuppDateValid = !origSuppDate || origSuppDate <= voucherDate;
                const isBookDateValid = !origBookDate || origBookDate <= voucherDate;

                // Rule: original_supplier_invoice_date OR original_book_vchr_date must be <= voucher date
                if (!(isSuppDateValid || isBookDateValid)) {
                    console.warn(`[VALIDATION] Amendment validation failed for voucher ${header.book_vchr_no}: Original dates must be <= voucher date.`);
                }
            } else {
                 console.warn(`[VALIDATION] Amendment validation failed for voucher ${header.book_vchr_no}: is_amendment is YES but no original dates found.`);
            }
        }
    }

    // Round and fallback net_amount
    for (const v of voucherMap.values()) {
        if (!v.header.net_amount || v.header.net_amount <= 0) {
            v.header.net_amount =
                v.header.taxable_total +
                v.header.total_igst_amount + v.header.total_cgst_amount +
                v.header.total_sgst_amount + v.header.total_cess_amount +
                (v.header.round_off || 0);
        }
        for (const k of ['taxable_total', 'total_igst_amount', 'total_cgst_amount', 'total_sgst_amount', 'total_cess_amount', 'net_amount']) {
            v.header[k] = Math.round(v.header[k] * 100) / 100;
        }
    }

    const result = Array.from(voucherMap.values());
    console.log(`[processPurchaseSheet] ${result.length} unique vouchers from ${rows.length - dataStart} data rows`);
    return result;
};

module.exports = { processSalesSheet, processPurchaseSheet };
