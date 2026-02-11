
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

        // Common Columns
        if (header.includes('GSTIN OF SUPPLIER')) colMap['gstin_supplier'] = index;
        else if (header.includes('TRADE/LEGAL NAME') || header.includes('TRADE NAME')) colMap['trade_name'] = index;
        else if (header.includes('INVOICE NUMBER')) colMap['invoice_number'] = index;
        else if (header.includes('NOTE NUMBER')) colMap['note_number'] = index; // For CDNR
        else if (header.includes('INVOICE TYPE') || header.includes('NOTE TYPE')) colMap['invoice_type'] = index;
        else if (header.includes('INVOICE DATE') || header.includes('NOTE DATE')) colMap['invoice_date'] = index;
        else if (header.includes('INVOICE VALUE') || header.includes('NOTE VALUE')) colMap['invoice_value'] = index;
        else if (header.includes('PLACE OF SUPPLY')) colMap['place_of_supply'] = index;
        else if (header.includes('REVERSE CHARGE')) colMap['reverse_charge'] = index;
        else if (header.includes('TAXABLE VALUE')) colMap['taxable_value'] = index;
        else if (header.includes('INTEGRATED TAX')) colMap['igst_amount'] = index;
        else if (header.includes('CENTRAL TAX')) colMap['cgst_amount'] = index;
        else if (header.includes('STATE/UT TAX')) colMap['sgst_amount'] = index;
        else if (header.includes('CESS AMOUNT') || header.includes('CESS')) colMap['cess_amount'] = index;

        // GSTR-2B Specifics
        else if (header.includes('GSTR-1/IFF/GSTR-5 PERIOD')) colMap['filing_period'] = index;
        else if (header.includes('FILING DATE')) colMap['filing_date'] = index;
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
        else if (header.includes('BOE NUMBER')) colMap['boe_number'] = index;
        else if (header.includes('BOE DATE')) colMap['boe_date'] = index;
        else if (header.includes('ICEGATE REFERENCE DATE')) colMap['icegate_ref_date'] = index;

        // Amendment Specifics
        else if (header.includes('ORIGINAL INVOICE NUMBER')) colMap['original_invoice_number'] = index;
        else if (header.includes('ORIGINAL INVOICE DATE')) colMap['original_invoice_date'] = index;
    });
    return colMap;
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
const processB2BSheet = (rows, gstinId, fileReturnPeriod, sheetName) => {
    const isAmended = sheetName.endsWith('A');
    const isCDNR = sheetName.includes('CDNR') || sheetName.includes('DN');
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

    const headerRow = rows[headerRowIndex];
    if (rows[headerRowIndex + 1] && rows[headerRowIndex + 1].join('').includes('Invoice value')) {
        // Merge logic if needed, but usually main keywords are enough
    }

    const colMap = buildColumnMap(headerRow);
    const dataStartIndex = headerRowIndex + 1; // Or +2 if confirm double header

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 5) continue;

        const gstin = row[colMap['gstin_supplier'] || 0]?.toString().trim() || '';
        // Skip empty or total rows
        if (!gstin || gstin.toUpperCase().includes('TOTAL') || gstin.length < 5) continue;

        // Common Fields
        const commonData = {
            gstin_id: gstinId, // Foreign Key
            return_period: fileReturnPeriod, // Partition Key
            gstin_supplier: gstin,
            trade_name: colMap['trade_name'] !== undefined ? row[colMap['trade_name']] : null,
            place_of_supply: colMap['place_of_supply'] !== undefined ? row[colMap['place_of_supply']] : null,
            reverse_charge: colMap['reverse_charge'] !== undefined ? (row[colMap['reverse_charge']]?.toString().toUpperCase().startsWith('Y') ? 'Y' : 'N') : 'N',
            taxable_value: cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0),
            igst_amount: cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0),
            cgst_amount: cleanAmount(colMap['cgst_amount'] !== undefined ? row[colMap['cgst_amount']] : 0),
            sgst_amount: cleanAmount(colMap['sgst_amount'] !== undefined ? row[colMap['sgst_amount']] : 0),
            cess_amount: cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0),
            filing_period: colMap['filing_period'] !== undefined ? row[colMap['filing_period']] : null,
            filing_date: parseExcelDate(colMap['filing_date'] !== undefined ? row[colMap['filing_date']] : null),
            itc_availability: colMap['itc_availability'] !== undefined ? (row[colMap['itc_availability']]?.toString().toUpperCase().startsWith('Y') ? 'Yes' : 'No') : 'Yes',
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
        };

        if (isCDNR) {
            // Processing CDNR Record
            const noteNum = colMap['note_number'] !== undefined ? row[colMap['note_number']] : '';
            if (!noteNum) continue;

            results.push({
                ...commonData,
                target_table: 'gstr_2b_cdnr',
                note_number: noteNum,
                note_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'C', // Credit/Debit
                note_date: parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null),
                note_value: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),
            });
        } else {
            // Processing B2B Record
            const invNum = colMap['invoice_number'] !== undefined ? row[colMap['invoice_number']] : '';
            if (!invNum) continue;

            const b2bRecord = {
                ...commonData,
                target_table: 'gstr_2b_b2b_invoices',
                invoice_number: invNum,
                invoice_type: colMap['invoice_type'] !== undefined ? row[colMap['invoice_type']] : 'Regular',
                invoice_date: parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null),
                invoice_value: cleanAmount(colMap['invoice_value'] !== undefined ? row[colMap['invoice_value']] : 0),
            };

            results.push(b2bRecord);

            if (isAmended) {
                // Also create an entry for b2ba_amendments log if needed, 
                // OR logically B2BA implies the record in B2B table IS the amendment.
                // The doc says "Create gstr_2b_b2ba_amendments to handle specific Original vs Revised columns".
                // So we should insert into that table too.
                const originalInv = colMap['original_invoice_number'] !== undefined ? row[colMap['original_invoice_number']] : null;
                if (originalInv) {
                    results.push({
                        target_table: 'gstr_2b_b2ba_amendments',
                        gstin_supplier: gstin,
                        gstin_id: gstinId,
                        return_period: fileReturnPeriod,
                        original_invoice_number: originalInv,
                        original_invoice_date: parseExcelDate(colMap['original_invoice_date'] !== undefined ? row[colMap['original_invoice_date']] : null),
                        revised_invoice_number: invNum,
                        revised_invoice_date: parseExcelDate(colMap['invoice_date'] !== undefined ? row[colMap['invoice_date']] : null)
                    });
                }
            }
        }
    }
    return results;
};

const processImportSheet = (rows, gstinId, fileReturnPeriod) => {
    const results = [];
    const headerRowIndex = getHeaderIndex(rows, ['BOE NUMBER', 'PORT CODE']);
    if (headerRowIndex === -1) return [];

    const colMap = buildColumnMap(rows[headerRowIndex]);
    const dataStartIndex = headerRowIndex + 1;

    for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue;

        const portCode = colMap['port_code'] !== undefined ? row[colMap['port_code']] : '';
        const boeNum = colMap['boe_number'] !== undefined ? row[colMap['boe_number']] : '';
        if (!boeNum) continue;

        results.push({
            target_table: 'gstr_2b_impg',
            gstin_id: gstinId,
            return_period: fileReturnPeriod,
            port_code: portCode,
            boe_number: boeNum,
            boe_date: parseExcelDate(colMap['boe_date'] !== undefined ? row[colMap['boe_date']] : null),
            icegate_ref_date: parseExcelDate(colMap['icegate_ref_date'] !== undefined ? row[colMap['icegate_ref_date']] : null),
            taxable_value: cleanAmount(colMap['taxable_value'] !== undefined ? row[colMap['taxable_value']] : 0),
            igst_amount: cleanAmount(colMap['igst_amount'] !== undefined ? row[colMap['igst_amount']] : 0),
            cess_amount: cleanAmount(colMap['cess_amount'] !== undefined ? row[colMap['cess_amount']] : 0)
        });
    }
    return results;
};

// Summary sheet processor remains mostly similar but we might not need to store it if we compute it?
// Or store in a dedicated simple summary table. For now, skipping unless requested. 
// Existing code had processSummarySheet.

module.exports = {
    processB2BSheet,
    processImportSheet
};
