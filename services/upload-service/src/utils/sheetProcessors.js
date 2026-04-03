
const { isValidGSTIN, normalizeInvoiceNumber, parseExcelDate, cleanAmount } = require('./validation');

/**
 * GSTR-2B Sheet Processors
 * Enhanced for Multi-Table Schema and Partitioning
 */

const getHeaderIndex = (rows, keywords) => {
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const rowStr = rows[i]?.join(' ').toUpperCase() || '';
        if (keywords.some(k => rowStr.includes(k))) {
            // Check for multi-row headers - usually the next row has specific columns involved or is empty/continuation
            return i;
        }
    }
    return -1;
};

const buildColumnMap = (headerRow) => {
    const colMap = {};
    headerRow.forEach((cell, index) => {
        const header = cell?.toString().toUpperCase().trim() || '';

        // Amendment Specifics (Old format explicit names)
        if (header.includes('ORIGINAL INVOICE/NOTE NUMBER') || header.includes('ORIGINAL INVOICE NUMBER') || header.includes('ORIGINAL NOTE NUMBER')) colMap['original_invoice_number'] = index;
        else if (header.includes('ORIGINAL INVOICE/NOTE DATE') || header.includes('ORIGINAL INVOICE DATE') || header.includes('ORIGINAL NOTE DATE')) colMap['original_invoice_date'] = index;
        else if (header.includes('ORIGINAL ISD DOCUMENT NUMBER')) colMap['original_isd_doc_number'] = index;
        else if (header.includes('ORIGINAL ISD DOCUMENT DATE')) colMap['original_isd_doc_date'] = index;

        // Common Columns (Handle duplicates for new 122025 Amendment format)
        else if (header.includes('GSTIN OF SUPPLIER')) colMap['gstin_supplier'] = index;
        else if (header.includes('TRADE/LEGAL NAME') || header.includes('TRADE NAME') || header === 'NAME') colMap['trade_name'] = index;

        else if (header.includes('INVOICE NUMBER') || header.includes('INVOICE/REF') || header.includes('INVOICE/DEBIT/CREDIT NOTE NUMBER') || header.match(/INVOICE NO\b|INV NO\b/)) {
            if (colMap['invoice_number'] !== undefined) {
                colMap['original_invoice_number'] = colMap['invoice_number'];
                colMap['invoice_number'] = index;
            } else {
                colMap['invoice_number'] = index;
            }
        }
        else if (header.includes('NOTE NUMBER') || header.match(/NOTE NO\b|NT NO\b/)) {
            if (colMap['note_number'] !== undefined) {
                colMap['original_note_number'] = colMap['note_number'];
                colMap['note_number'] = index;
            } else {
                colMap['note_number'] = index;
            }
        }
        else if (header.match(/INVOICE TYPE|NOTE TYPE|GST TYPE|GSTR TYPE|DOCUMENT TYPE/)) colMap['invoice_type'] = index;
        else if (header.includes('INVOICE DATE') || header.includes('NOTE DATE') || header.includes('INVOICE/DEBIT/CREDIT NOTE DATE') || header.match(/INV DATE\b|NT DATE\b|IDT\b|NTDT\b/)) {
            if (colMap['invoice_date'] !== undefined) {
                colMap['original_invoice_date'] = colMap['invoice_date'];
                colMap['invoice_date'] = index;
            } else {
                colMap['invoice_date'] = index;
            }
        }

        else if (header.match(/TAX PERIOD|RETURN PERIOD|MONTH/)) colMap['return_period'] = index;

        else if ((header.includes('INVOICE VALUE') || header.includes('NOTE VALUE') || header.includes('INVOICE AMT')) && colMap['invoice_value'] === undefined) colMap['invoice_value'] = index;
        else if (header.includes('PLACE OF SUPPLY')) colMap['place_of_supply'] = index;
        else if (header.match(/REVERSE CHARGE|RCM|REV.? CHARGE/)) colMap['reverse_charge'] = index;
        else if ((header.includes('TAXABLE VALUE') || header.includes('TAXABLE AMT') || header === 'TAXABLE') && colMap['taxable_value'] === undefined) colMap['taxable_value'] = index;
        
        // Tax Columns - Be more inclusive for shorter headers but prioritize the first match (Amount)
        // Note: GSTR-2B often has duplicate "Integrated Tax" headers for Amount and ITC Eligibility.
        else if ((header.includes('INTEGRATED TAX') || header.match(/\bIGST\b/)) && colMap['igst_amount'] === undefined) colMap['igst_amount'] = index;
        else if ((header.includes('CENTRAL TAX') || header.match(/\bCGST\b/)) && colMap['cgst_amount'] === undefined) colMap['cgst_amount'] = index;
        else if ((header.includes('STATE/UT TAX') || header.match(/\bSGST\b/)) && colMap['sgst_amount'] === undefined) colMap['sgst_amount'] = index;
        else if ((header.includes('CESS AMOUNT') || header === 'CESS') && colMap['cess_amount'] === undefined) colMap['cess_amount'] = index;
        
        // Handle generic 'Tax AMT' when detailed split isn't available
        else if ((header === 'TAX AMT' || header === 'TAX AMOUNT' || header === 'TOTAL TAX') && colMap['total_tax_amount'] === undefined) colMap['total_tax_amount'] = index;
        else if (header === 'TAX %' || header === 'TAX RATE') colMap['tax_rate_percentage'] = index;

        // GSTR-2B Specifics
        else if (header.match(/GSTR-1\/IFF\/GSTR-5 PERIOD|FILING PERIOD|SUPPLIER FILING PERIOD/)) colMap['filing_period'] = index;
        else if (header.match(/FILING DATE|SUPPLIER FILING DATE/)) colMap['filing_date'] = index;
        else if (header.match(/^STATUS$|RECONCILED STATUS|RECONCILIATION STATUS|RECON STATUS/)) colMap['reconciliation_status'] = index;
        else if (header.includes('ITC AVAILABILITY')) colMap['itc_availability'] = index;
        else if (header.includes('REASON')) colMap['unavailability_reason'] = index;
        else if (header.includes('APPLICABLE % OF TAX RATE')) colMap['tax_rate_percentage'] = index;
        else if (header.includes('SOURCE')) colMap['source'] = index;
        else if (header.includes('IRN') && !header.includes('DATE')) colMap['irn'] = index;
        else if (header.includes('IRN DATE')) colMap['irn_date'] = index;

        // IMS Specifics
        else if (header.includes('IMS ACTION') || header.includes('IMS STATUS')) colMap['ims_action_status'] = index;
        else if (header.includes('REMARKS')) colMap['remarks'] = index;
        else if (header.includes('ITC REDUCTION FLAG')) colMap['itc_reduction_flag'] = index;
        else if (header.includes('AMOUNT DECLARED') && header.includes('IGST')) colMap['itc_reduction_igst'] = index;
        else if (header.includes('AMOUNT DECLARED') && header.includes('CGST')) colMap['itc_reduction_cgst'] = index;
        else if (header.includes('AMOUNT DECLARED') && header.includes('SGST')) colMap['itc_reduction_sgst'] = index;
        else if (header.includes('AMOUNT DECLARED') && header.includes('CESS')) colMap['itc_reduction_cess'] = index;

        // IMPG Specifics
        else if (header.includes('PORT CODE')) colMap['port_code'] = index;
        else if (header.includes('BOE NUMBER') || header.includes('ENTRY DETAILS NUMBER')) colMap['boe_number'] = index;
        else if (header.includes('BOE DATE') || header === 'DATE') colMap['boe_date'] = index;
        else if (header.includes('ICEGATE REFERENCE DATE')) colMap['icegate_ref_date'] = index;

        // ISD Specifics
        else if (header.includes('GSTIN OF ISD')) colMap['gstin_isd'] = index;
        else if (header.includes('ISD NAME')) colMap['isd_name'] = index;
        else if (header.includes('ISD DOCUMENT NUMBER')) {
            if (colMap['isd_doc_number'] !== undefined) {
                colMap['original_isd_doc_number'] = colMap['isd_doc_number'];
                colMap['isd_doc_number'] = index;
            } else {
                colMap['isd_doc_number'] = index;
            }
        }
        else if (header.includes('ISD DOCUMENT DATE')) {
            if (colMap['isd_doc_date'] !== undefined) {
                colMap['original_isd_doc_date'] = colMap['isd_doc_date'];
                colMap['isd_doc_date'] = index;
            } else {
                colMap['isd_doc_date'] = index;
            }
        }
    });
    console.log('[DEBUG] Column Map:', JSON.stringify(colMap));
    return colMap;
};

/**
 * Helper to determine Return Period from the row if available, parsing formats like 'Apr 2025' -> '042025'
 */
const parseTaxPeriod = (tp) => {
    if (!tp) return null;
    const str = tp.toString().trim();
    if (/^\d{6}$/.test(str)) return str;
    const match = str.match(/([a-zA-Z]{3})[\s-]*(\d{4})/);
    if (match) {
        const monthStr = match[1].toLowerCase();
        const year = match[2];
        const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        if (months[monthStr]) return `${months[monthStr]}${year}`;
    }
    return str;
};

/**
 * Helper to determine Return Period from the first valid data row if not provided
 * or standardizes it to MMYYYY format.
 */
const extractReturnPeriod = (row, colMap, defaultPeriod) => {
    // Ideally this comes from the file context or filename, but if we need to extract from row:
    // Filing Period col usually has "Dec'25"
    // We need '122025'
    // This function is placeholder if we need row-level extraction. gstr2bController should pass specific period.
    return defaultPeriod;
};

/**
 * Mappping arbitrary extracted strings (even HTML dropdowns!) to valid DB Enums for Status
 */
const extractReconStatus = (val) => {
    if (!val) return 'pending';
    let str = val.toString();
    
    // If it's HTML, try to extract the text of the 'selected' option
    if (str.includes('<select')) {
        const match = str.match(/<option[^>]*selected[^>]*>([^<]*)<\/option>/i);
        if (match && match[1]) {
            str = match[1];
        } else {
            return 'pending'; // fallback if no default selected
        }
    }
    
    str = str.toLowerCase().trim();
    if (str.includes('claim') && !str.includes('not')) return 'claimed';
    if (str.includes('not') && str.includes('claim')) return 'not_to_be_claimed';
    if (str.includes('wrong') || str.includes('portal') || str.includes('issue')) return 'wrong_entry_portal';
    if (str.includes('eligible')) return 'not_eligible_for_claim';
    
    return 'pending';
};

const processedDataFactory = () => ({
    b2b: [],
    cdnr: [],
    amendments: [],
    impg: [],
    itc_reversal: []
});

/**
 * Process B2B, B2BA, CDNR, CDNRA, ECO Sheets
 */
const processB2BSheet = (rows, gstinId, fileReturnPeriod, sheetName, gstrType = 'GSTR2B') => {
    const isGstr2a = gstrType.toUpperCase().includes('2A');
    const tablePrefix = isGstr2a ? 'gstr_2a' : 'gstr_2b';
    const isAmended = sheetName.endsWith('A');
    const isCDNR = sheetName.includes('CDNR') || sheetName.includes('DN') || sheetName.includes('CDN');
    // const results = processedDataFactory(); // We return flat array here, controller sorts it? No, let's return structured if possible?
    // Maintaining compatibility: Return array of objects with 'table_target' property?
    // Or just generic objects and let Controller map to tables.
    // Given the new schema, B2B and CDNR are different tables.
    // Let's add a 'target_table' field to each result object.

    const results = [];

    // Header detection
    const headerRowIndex = getHeaderIndex(rows, ['GSTIN OF SUPPLIER', 'INVOICE NUMBER', 'NOTE NUMBER']);
    if (headerRowIndex === -1) return [];

    // Header Processing (handle multi-row headers)
    // Sometimes headers span 2 rows. If row[headerRowIndex+1] looks like sub-headers, merge them?
    // Simplified: Use the row that contains 'GSTIN OF SUPPLIER'.

    // Header Processing (handle multi-row headers)
    // Merge current row and next row if next row contains key columns like 'Invoice', 'Tax', 'Note'
    let headerRow = rows[headerRowIndex];
    const nextRow = rows[headerRowIndex + 1];
    let isMerged = false;

    if (nextRow && nextRow.some(cell => cell && (
        cell.toString().toUpperCase().includes('INVOICE') ||
        cell.toString().toUpperCase().includes('TAX') ||
        cell.toString().toUpperCase().includes('NOTE')
    ))) {
        // Merge with next row if mapped
        if (nextRow) {
            const mergedHeader = [];
            const len = Math.max(headerRow.length, nextRow.length);
            for (let idx = 0; idx < len; idx++) {
                const val1 = headerRow[idx] ? headerRow[idx].toString().toUpperCase().trim() : '';
                const val2 = nextRow[idx] ? nextRow[idx].toString().toUpperCase().trim() : '';
                mergedHeader[idx] = (val1 + ' ' + val2).trim();
            }
            headerRow = mergedHeader;
            isMerged = true;
        }

    }

    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + (isMerged ? 2 : 1);

    // Sticky headers for multi-row records (e.g., GSTR-2B item details)
    let stickyGstin = '';
    let stickyTradeName = '';
    let stickyInvoiceNo = '';
    let stickyNoteNo = '';
    let stickyDate = null;
    let stickyPlaceOfSupply = '';
    let stickyReverseCharge = 'N';

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        let gstin = row[colMap['gstin_supplier']]?.toString().trim() || '';
        let invoiceNoRaw = colMap['invoice_number'] !== undefined ? row[colMap['invoice_number']] : '';
        let noteNoRaw = colMap['note_number'] !== undefined ? row[colMap['note_number']] : '';

        // Update sticky values if we have a new key (GSTIN + Invoice/Note)
        if (gstin && isValidGSTIN(gstin)) {
            stickyGstin = gstin;
            stickyTradeName = colMap['trade_name'] !== undefined ? row[colMap['trade_name']] : null;
            stickyInvoiceNo = invoiceNoRaw;
            stickyNoteNo = noteNoRaw;
            stickyDate = parseExcelDate(row[colMap['invoice_date']]);
            stickyPlaceOfSupply = colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null;
            stickyReverseCharge = colMap['reverse_charge'] !== undefined ? (row[colMap['reverse_charge']]?.toString().toUpperCase().match(/Y|YES|TRUE/) ? 'Y' : 'N') : 'N';
        } else if (stickyGstin && (row[colMap['taxable_value']] !== undefined || row[colMap['igst_amount']] !== undefined)) {
            // Use sticky values for rows that look like data but miss headers
            gstin = stickyGstin;
            invoiceNoRaw = stickyInvoiceNo;
            noteNoRaw = stickyNoteNo;
        }

        // Skip if still no valid GSTIN (e.g. total rows, empty rows)
        if (!gstin || gstin.toUpperCase().includes('TOTAL') || !isValidGSTIN(gstin)) continue;

        const rowReturnPeriod = colMap['return_period'] !== undefined ? parseTaxPeriod(row[colMap['return_period']]) : null;
        
        let igst = cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0);
        let cgst = cleanAmount(colMap['cgst_amount'] !== undefined ? row[colMap['cgst_amount']] : 0);
        let sgst = cleanAmount(colMap['sgst_amount'] !== undefined ? row[colMap['sgst_amount']] : 0);
        
        // Handle generic tax amount mapped without split using naive split or assume IGST if inter-state logic exists.
        // For simplicity, we fallback to IGST if no split is there but total exists
        if (colMap['total_tax_amount'] !== undefined && !igst && !cgst && !sgst) {
            igst = cleanAmount(row[colMap['total_tax_amount']]);
        }

        // Common Fields
        const commonData = {
            gstin_id: gstinId, // Foreign Key
            return_period: rowReturnPeriod || fileReturnPeriod, // Prefer row-level period format
            gstin_supplier: gstin,
            trade_name: gstin === stickyGstin ? stickyTradeName : (colMap['trade_name'] !== undefined ? row[colMap['trade_name']] : null),
            place_of_supply: gstin === stickyGstin ? stickyPlaceOfSupply : (colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null),
            reverse_charge: gstin === stickyGstin ? stickyReverseCharge : (colMap['reverse_charge'] !== undefined ? (row[colMap['reverse_charge']]?.toString().toUpperCase().match(/Y|YES|TRUE/) ? 'Y' : 'N') : 'N'),
            taxable_value: cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0),
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0),
            filing_period: colMap['filing_period'] !== undefined ? row[colMap['filing_period']] : null,
            filing_date: gstin === stickyGstin ? stickyDate : parseExcelDate(colMap['filing_date'] !== undefined ? row[colMap['filing_date']] : null),
            reconciliation_status: colMap['reconciliation_status'] !== undefined ? extractReconStatus(row[colMap['reconciliation_status']]) : 'pending',
            itc_availability: colMap['itc_availability'] !== undefined ? (row[colMap['itc_availability']]?.toString().toUpperCase().match(/Y|YES|TRUE/) ? 'Yes' : 'No') : 'Yes',
            unavailability_reason: colMap['unavailability_reason'] !== undefined ? row[colMap['unavailability_reason']] : null,

            // IMS & Additional
            source: colMap['source'] !== undefined ? row[colMap['source']] : null,
            irn: colMap['irn'] !== undefined ? row[colMap['irn']] : null,
            irn_date: parseExcelDate(colMap['irn_date'] !== undefined ? row[colMap['irn_date']] : null),
            ims_action_status: colMap['ims_action_status'] !== undefined ? row[colMap['ims_action_status']] : null,
            remarks: colMap['remarks'] !== undefined ? row[colMap['remarks']] : null,
            itc_reduction_flag: colMap['itc_reduction_flag'] !== undefined ? row[colMap['itc_reduction_flag']] : null,
            itc_reduction_igst: cleanAmount(colMap['itc_reduction_igst'] !== undefined ? row[colMap['itc_reduction_igst']] : 0),
            itc_reduction_cgst: cleanAmount(colMap['itc_reduction_cgst'] !== undefined ? row[colMap['itc_reduction_cgst']] : 0),
            itc_reduction_sgst: cleanAmount(colMap['itc_reduction_sgst'] !== undefined ? row[colMap['itc_reduction_sgst']] : 0),
            itc_reduction_cess: cleanAmount(colMap['itc_reduction_cess'] !== undefined ? row[colMap['itc_reduction_cess']] : 0),
            applicable_tax_rate: colMap['tax_rate_percentage'] !== undefined ? row[colMap['tax_rate_percentage']]?.toString() : null
        };

        if (isCDNR) {
            // Processing CDNR Record
            const noteNumRaw = noteNoRaw;
            const noteNum = noteNumRaw ? normalizeInvoiceNumber(noteNumRaw.toString()) : '';
            if (!noteNum) continue;

            const originalInvNumRaw = colMap['original_invoice_number'] !== undefined ? row[colMap['original_invoice_number']] : null;
            const originalInvNum = originalInvNumRaw ? normalizeInvoiceNumber(originalInvNumRaw.toString()) : null;

            results.push({
                ...commonData,
                target_table: isAmended ? `${tablePrefix}_cdnra` : `${tablePrefix}_cdnr`,
                note_number: noteNum,
                note_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'C', // Credit/Debit
                note_date: parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null),
                note_value: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),
                original_invoice_number: originalInvNum,
                original_invoice_date: parseExcelDate(colMap['original_invoice_date'] !== undefined ? row[colMap['original_invoice_date']] : null),
                // CDNRA specific
                original_note_number: isAmended ? (originalInvNum || noteNum) : null,
                original_note_date: isAmended ? parseExcelDate(colMap['original_invoice_date'] !== undefined ? row[colMap['original_invoice_date']] : null) : null,
                revised_note_number: isAmended ? noteNum : null,
                revised_note_date: isAmended ? parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null) : null,
                is_amended: isAmended
            });
        } else {
            // Processing B2B Record
            const invNumRaw = invoiceNoRaw;
            const invNum = invNumRaw ? normalizeInvoiceNumber(invNumRaw.toString()) : '';
            if (!invNum) continue;

            const b2bRecord = {
                ...commonData,
                target_table: `${tablePrefix}_b2b_invoices`,
                invoice_number_raw: invNumRaw?.toString().trim() || null,
                invoice_number: invNum,
                invoice_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'Regular',
                invoice_date: gstin === stickyGstin ? stickyDate : parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null),
                invoice_value: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),
            };

            if (isAmended) {
                // For B2BA, we map to gstr_2b_b2ba_invoices
                const originalInvRaw = colMap['original_invoice_number'] !== undefined ? row[colMap['original_invoice_number']] : null;
                const originalInv = originalInvRaw ? normalizeInvoiceNumber(originalInvRaw.toString()) : null;
                results.push({
                    ...commonData,
                    target_table: `${tablePrefix}_b2ba_invoices`,
                    original_invoice_number: originalInv || invNum, // fallback to current if not provided
                    original_invoice_date: parseExcelDate(colMap['original_invoice_date'] !== undefined ? row[colMap['original_invoice_date']] : null),
                    revised_invoice_number: invNum,
                    revised_invoice_date: b2bRecord.invoice_date,
                    invoice_type: b2bRecord.invoice_type,
                    invoice_value: b2bRecord.invoice_value,
                    is_amended: true
                });
            } else {
                results.push(b2bRecord);
            }
        }
    }
    return results;
};

const processImportSheet = (rows, gstinId, fileReturnPeriod, gstrType = 'GSTR2B') => {
    const isGstr2a = gstrType.toUpperCase().includes('2A');
    const tablePrefix = isGstr2a ? 'gstr_2a' : 'gstr_2b';
    const results = [];
    const headerRowIndex = getHeaderIndex(rows, ['BOE NUMBER', 'PORT CODE']);
    if (headerRowIndex === -1) return [];

    let headerRow = rows[headerRowIndex];
    const nextRow = rows[headerRowIndex + 1];
    let isMerged = false;

    if (nextRow && nextRow.some(cell => cell && (
        cell.toString().toUpperCase().includes('DATE') ||
        cell.toString().toUpperCase().includes('TAX')
    ))) {
        headerRow = headerRow.map((cell, idx) => {
            const val1 = cell ? cell.toString().toUpperCase().trim() : '';
            const val2 = nextRow[idx] ? nextRow[idx].toString().toUpperCase().trim() : '';
            return (val1 + ' ' + val2).trim();
        });
        isMerged = true;
    }

    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + (isMerged ? 2 : 1);

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue;

        const portCode = colMap['port_code'] !== undefined ? row[colMap['port_code']] : '';
        const boeNum = colMap['boe_number'] !== undefined ? row[colMap['boe_number']] : '';
        if (!boeNum) continue;

        results.push({
            target_table: `${tablePrefix}_impg`,
            gstin_id: gstinId,
            return_period: fileReturnPeriod,
            port_code: portCode,
            boe_number: boeNum,
            boe_date: parseExcelDate(colMap['boe_date'] !== undefined ? row[colMap['boe_date']] : null),
            icegate_ref_date: parseExcelDate(colMap['icegate_ref_date'] !== undefined ? row[colMap['icegate_ref_date']] : null),
            taxable_value: cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0),
            integrated_tax: cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0),
            cess: cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0),
            itc_availability: colMap['itc_availability'] !== undefined ? (row[colMap['itc_availability']]?.toString().toUpperCase().startsWith('Y') ? 'Yes' : 'No') : 'Yes',
            itc_availability_reason: colMap['unavailability_reason'] !== undefined ? row[colMap['unavailability_reason']] : null,
            applicable_tax_rate: colMap['tax_rate_percentage'] !== undefined ? row[colMap['tax_rate_percentage']]?.toString() : null
        });
    }
    return results;
};

const processISDSheet = (rows, gstinId, fileReturnPeriod, sheetName, gstrType = 'GSTR2B') => {
    const isGstr2a = gstrType.toUpperCase().includes('2A');
    const tablePrefix = isGstr2a ? 'gstr_2a' : 'gstr_2b';
    const isAmended = sheetName.endsWith('A');
    const results = [];
    const headerRowIndex = getHeaderIndex(rows, ['GSTIN OF ISD', 'ISD DOCUMENT NUMBER']);
    if (headerRowIndex === -1) return [];

    let headerRow = rows[headerRowIndex];
    const nextRow = rows[headerRowIndex + 1];
    let isMerged = false;

    if (nextRow && nextRow.some(cell => cell && (
        cell.toString().toUpperCase().includes('DOCUMENT') ||
        cell.toString().toUpperCase().includes('TAX')
    ))) {
        headerRow = headerRow.map((cell, idx) => {
            const val1 = cell ? cell.toString().toUpperCase().trim() : '';
            const val2 = nextRow[idx] ? nextRow[idx].toString().toUpperCase().trim() : '';
            return (val1 + ' ' + val2).trim();
        });
        isMerged = true;
    }

    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + (isMerged ? 2 : 1);

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        const gstinIsd = row[colMap['gstin_isd']]?.toString().trim() || '';
        if (!gstinIsd || gstinIsd.toUpperCase().includes('TOTAL') || !isValidGSTIN(gstinIsd)) continue;

        results.push({
            target_table: `${tablePrefix}_isd`,
            gstin_id: gstinId,
            return_period: fileReturnPeriod,
            gstin_isd: gstinIsd,
            isd_name: colMap['isd_name'] !== undefined ? row[colMap['isd_name']] : null,
            document_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : (isAmended ? 'ISD Amendment' : 'ISD Document'),
            document_number: colMap['isd_doc_number'] !== undefined ? row[colMap['isd_doc_number']] : '',
            document_date: parseExcelDate(colMap['isd_doc_date'] !== undefined ? row[colMap['isd_doc_date']] : null),
            integrated_tax: cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0),
            central_tax: cleanAmount(colMap['cgst_amount'] !== undefined ? row[colMap['cgst_amount']] : 0),
            state_ut_tax: cleanAmount(colMap['sgst_amount'] !== undefined ? row[colMap['sgst_amount']] : 0),
            cess: cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0),
            itc_availability: colMap['itc_availability'] !== undefined ? (row[colMap['itc_availability']]?.toString().toUpperCase().startsWith('Y') ? 'Yes' : 'No') : 'Yes',
            is_amended: isAmended,
            original_document_number: isAmended ? (colMap['original_isd_doc_number'] !== undefined ? row[colMap['original_isd_doc_number']] : null) : null,
            original_document_date: isAmended ? parseExcelDate(colMap['original_isd_doc_date'] !== undefined ? row[colMap['original_isd_doc_date']] : null) : null
        });
    }
    return results;
};

// Summary sheet processor remains mostly similar but we might not need to store it if we compute it?
// Or store in a dedicated simple summary table. For now, skipping unless requested. 
// Existing code had processSummarySheet.

module.exports = {
    processB2BSheet,
    processImportSheet,
    processISDSheet
};
