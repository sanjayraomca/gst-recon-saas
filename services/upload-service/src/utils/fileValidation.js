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

module.exports = {
    validateFileGSTIN
};
