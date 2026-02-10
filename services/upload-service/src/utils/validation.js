/**
 * GST Data Validation Utilities
 */

/**
 * Validates GSTIN format (15 characters, alphanumeric)
 * @param {string} gstin 
 * @returns {boolean}
 */
const isValidGSTIN = (gstin) => {
    if (!gstin) return false;
    const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return regex.test(gstin.toUpperCase());
};

/**
 * Normalizes invoice number (alphanumeric only, uppercase)
 * @param {string} invNum 
 * @returns {string}
 */
const normalizeInvoiceNumber = (invNum) => {
    if (!invNum) return '';
    return invNum.toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
};

/**
 * Parses date from Excel format (can be DD/MM/YYYY or decimal)
 * @param {any} dateVal 
 * @returns {string|null} YYYY-MM-DD
 */
const parseExcelDate = (dateVal) => {
    if (!dateVal) return null;

    // If already a JS Date
    if (dateVal instanceof Date) {
        return dateVal.toISOString().split('T')[0];
    }

    // If string in DD/MM/YYYY or DD-MM-YYYY
    if (typeof dateVal === 'string') {
        const parts = dateVal.split(/[\/\-]/);
        if (parts.length === 3) {
            let day, month, year;
            if (parts[2].length === 4) { // DD/MM/YYYY
                [day, month, year] = parts;
            } else if (parts[0].length === 4) { // YYYY/MM/DD
                [year, month, day] = parts;
            }
            if (day && month && year) {
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
        }
    }

    return null;
};

/**
 * Cleans numeric values (strips ₹, commas)
 * @param {any} val 
 * @returns {number}
 */
const cleanAmount = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;

    const cleaned = val.toString().replace(/[₹, \s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
};

module.exports = {
    isValidGSTIN,
    normalizeInvoiceNumber,
    parseExcelDate,
    cleanAmount
};
