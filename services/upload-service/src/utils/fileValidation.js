/**
 * GSTIN Validation for Uploaded Files
 */


/**
 * Validates that the workbook contains sheets/keywords expected for a specific GSTR or Book type.
 * Also detects if a Purchase file is being uploaded to the Sales import endpoint (and vice versa)
 * by inspecting the vchr_type column values in the data rows.
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
    if (typeUpper === 'SALES' || typeUpper === 'PURCHASE' ||
        typeUpper === 'SALES_RETURN' || typeUpper === 'PURCHASE_RETURN' ||
        typeUpper === 'SALES_REGISTER' || typeUpper === 'PURCHASE_REGISTER') {

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const xlsx = require('xlsx');
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, range: 0 });

        // Collect all text from the first 15 rows into one big uppercase string (header scan)
        let headerText = '';
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
            headerText += ' ' + (rows[i]?.join(' ') || '');
        }
        headerText = headerText.toUpperCase();

        // Generic check — must at least look like a book register
        const genericKeywords = ['GSTIN', 'INVOICE', 'DATE', 'AMT', 'VCHR', 'TOTAL'];
        const genericMatches = genericKeywords.filter(k => headerText.includes(k)).length;
        if (genericMatches < 2) {
            return {
                valid: false,
                message: `File Mismatch: The uploaded file does not look like a Sales or Purchase Register. Please ensure it follows the correct template.`
            };
        }

        // --- vchr_type based detection ---
        // Both Sales and Purchase CSVs from this vendor share identical column names.
        // The only reliable way to distinguish them is by reading actual data row values.
        // Sales files:    vchr_type = 'SA' (standard sale) or 'SR' (sales return)
        // Purchase files: vchr_type = 'EXP' (expense), 'PA' (purchase), 'DN' (debit note)
        let headerRowIndex = -1;
        let vchTypeColIndex = -1;

        // Find the header row and vchr_type column
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const row = rows[i] || [];
            const rowStr = row.join(' ').toUpperCase();
            if (rowStr.includes('VCHR') || rowStr.includes('INVOICE') || rowStr.includes('ORG_GSTIN')) {
                headerRowIndex = i;
                for (let j = 0; j < row.length; j++) {
                    const col = (row[j] || '').toString().toLowerCase().trim().replace(/\s+/g, '_');
                    if (col === 'vchr_type' || col === 'vch_type' || col === 'invoice_type' || col === 'voucher_type') {
                        vchTypeColIndex = j;
                        break;
                    }
                }
                break;
            }
        }

        if (headerRowIndex !== -1 && vchTypeColIndex !== -1) {
            // Known vchr_type values for each register type
            // CN and DN exist in BOTH, so we shouldn't use them to strictly classify
            const strictSalesVchrTypes = new Set(['SA', 'SR']);
            const strictPurchaseVchrTypes = new Set(['EXP', 'PA', 'PN']);

            let salesTypeCount = 0;
            let purchaseTypeCount = 0;
            const dataStart = headerRowIndex + 1;

            // Sample up to 50 data rows to determine the predominant voucher type
            for (let i = dataStart; i < Math.min(rows.length, dataStart + 50); i++) {
                const row = rows[i];
                if (!row) continue;
                const vchrType = (row[vchTypeColIndex] || '').toString().toUpperCase().trim();

                if (strictSalesVchrTypes.has(vchrType)) {
                    salesTypeCount++;
                } else if (strictPurchaseVchrTypes.has(vchrType)) {
                    purchaseTypeCount++;
                }
            }

            const isSalesUpload = typeUpper === 'SALES' || typeUpper === 'SALES_RETURN' || typeUpper === 'SALES_REGISTER';
            const isPurchaseUpload = typeUpper === 'PURCHASE' || typeUpper === 'PURCHASE_RETURN' || typeUpper === 'PURCHASE_REGISTER';

            console.log(`[DEBUG] vchr_type analysis: strictSalesCount=${salesTypeCount}, strictPurchaseCount=${purchaseTypeCount}, uploadType=${typeUpper}`);

            // File is clearly a Purchase file but uploaded to the Sales endpoint
            if (isSalesUpload && purchaseTypeCount > 0 && salesTypeCount === 0) {
                return {
                    valid: false,
                    message: `File Type Mismatch: The uploaded file appears to be a Purchase Register (contains purchase voucher types like EXP, PA), but you are importing it into Sales. Please upload the correct Sales Register file.`
                };
            }

            // File is clearly a Sales file but uploaded to the Purchase endpoint
            if (isPurchaseUpload && salesTypeCount > 0 && purchaseTypeCount === 0) {
                return {
                    valid: false,
                    message: `File Type Mismatch: The uploaded file appears to be a Sales Register (contains sales voucher types like SA, SR), but you are importing it into Purchase. Please upload the correct Purchase Register file.`
                };
            }
        }

        // Block GSTR files from being uploaded as book registers
        if (sNames.some(s => s.includes('B2B') && s.length < 10)) {
            return {
                valid: false,
                message: `File Mismatch: The uploaded file appears to be a GSTR portal file, not a Book Register. Please use the GSTR import section instead.`
            };
        }
    }

    return { valid: true };
};

module.exports = {
    validateFileType
};
