/**
 * GSTIN Validation for Uploaded Files
 */

/**
 * Scans an Excel workbook for the presence of a specific GSTIN.
 * It checks the first 50 rows of every sheet, looking for exact text matches.
 * 
 * @param {Object} workbook - Parsed xlsx workbook
 * @param {string} expectedGstin - The GSTIN of the Organization to validate against
 * @returns {boolean} - True if the expected GSTIN is found in the file, false otherwise
 */
const validateFileGSTIN = (workbook, expectedGstin) => {
    if (!workbook || !workbook.SheetNames || !expectedGstin) {
        console.log('[DEBUG] Validation failed: Missing workbook or expected GSTIN');
        return false;
    }

    const cleanExpected = expectedGstin.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
    console.log(`[DEBUG] Attempting to find GSTIN: ${cleanExpected}`);

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const xlsx = require('xlsx');
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

        const rowsToScan = Math.min(rows.length, 50);
        console.log(`[DEBUG] Scanning sheet: "${sheetName}" (${rowsToScan} rows)`);

        for (let i = 0; i < rowsToScan; i++) {
            const row = rows[i];
            if (!row) continue;

            const rowStr = row.join(' | ');
            if (i < 10) {
                console.log(`[DEBUG] Row ${i + 1}: ${rowStr.substring(0, 100)}${rowStr.length > 100 ? '...' : ''}`);
            }

            for (const cell of row) {
                if (cell) {
                    const cellStr = cell.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (cellStr.includes(cleanExpected)) {
                        console.log(`[DEBUG] MATCH FOUND in Row ${i + 1}! Cell: "${cell}" matched "${cleanExpected}"`);
                        return true;
                    }
                }
            }
        }
    }

    console.log(`[DEBUG] GSTIN ${cleanExpected} NOT FOUND anywhere in the scanned rows.`);
    return false;
};

/**
 * Validates that the workbook contains sheets/keywords expected for a specific GSTR or Book type.
 * 
 * @param {Object} workbook - Parsed xlsx workbook
 * @param {string} type - Expected type (e.g., GSTR2A, GSTR2B, SALES, PURCHASE)
 * @returns {Object} - { valid: boolean, message: string }
 */
const validateFileType = (workbook, type) => {
    if (!workbook || !workbook.SheetNames || !type) {
        return { valid: false, message: 'Invalid workbook or type provided.' };
    }

    const sNames = workbook.SheetNames.map(s => s.toUpperCase());
    const typeUpper = type.toUpperCase();

    // 1. GSTR-2A / 2B Validation
    if (typeUpper.includes('GSTR2A') || typeUpper.includes('GSTR2B') || typeUpper.includes('GSTR-2A') || typeUpper.includes('GSTR-2B')) {
        const hasGSTRSheets = sNames.some(s => s.includes('B2B') || s.includes('IMPG') || s.includes('ISD') || s.includes('CDN'));
        if (!hasGSTRSheets) {
            return {
                valid: false,
                message: `File Mismatch: The uploaded file does not appear to be a GSTR-2A/2B portal file. Expected sheets like 'B2B', 'IMPG', etc.`
            };
        }
    }

    // 2. Sales/Purchase Book Validation
    if (typeUpper === 'SALES' || typeUpper === 'PURCHASE' || typeUpper === 'SALES_REGISTER' || typeUpper === 'PURCHASE_REGISTER') {
        // Book files are usually single sheet or have specific headers. 
        // We'll check the first few rows of the first sheet for common keywords.
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const xlsx = require('xlsx');
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, range: 0 }); // Read first few rows

        const keywords = ['GSTIN', 'INVOICE', 'DATE', 'AMT', 'VOUCHER', 'VALUE', 'TAXABLE'];
        let matchedKeywords = 0;

        // Scan first 10 rows for keywords
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const rowStr = rows[i]?.join(' ').toUpperCase() || '';
            keywords.forEach(k => { if (rowStr.includes(k)) matchedKeywords++; });
        }

        if (matchedKeywords < 2) {
            return {
                valid: false,
                message: `File Mismatch: The uploaded file does not look like a Sales or Purchase Register. Please ensure it follows the correct template.`
            };
        }

        // Specific Prevention: If it's a GSTR file but being uploaded as a Book file (usually unlikely, but vice versa is common)
        if (sNames.some(s => s.includes('B2B') && s.length < 10)) {
            // Might be a GSTR file, but some users might name sheets B2B in books too. 
            // Usually GSTR files are very distinct.
        }
    }

    return { valid: true };
};

module.exports = {
    validateFileGSTIN,
    validateFileType
};
