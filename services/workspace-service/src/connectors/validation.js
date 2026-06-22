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

    // If string in DD/MM/YYYY or DD-MM-YYYY or DD-MMM-YYYY
    if (typeof dateVal === 'string') {
        const cleanDate = dateVal.trim();
        const parts = cleanDate.split(/[\/\-]/);
        if (parts.length === 3) {
            let day, month, year;
            if (parts[2].length === 4) { // DD/MM/YYYY or DD-MMM-YYYY
                [day, month, year] = parts;
            } else if (parts[0].length === 4) { // YYYY/MM/DD
                [year, month, day] = parts;
            } else if (parts[2].length === 2) { // DD/MM/YY
                [day, month, year] = parts;
                year = '20' + year; // Assume 20xx
            } else if (parts[0].length === 2) { // YY/MM/DD (Less common but possible)
                // Ambiguous with DD/MM/YY, but let's assume valid DD-MM-YY first
                [day, month, year] = parts;
                year = '20' + year;
            }

            // Handle MMM (Jan, Feb...)
            const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
            if (isNaN(month) && months[month.toLowerCase().substring(0, 3)]) {
                month = months[month.toLowerCase().substring(0, 3)];
            }

            if (day && month && year) {
                return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            }
        }
    }

    // If number (Excel serial date)
    if (typeof dateVal === 'number' || (typeof dateVal === 'string' && !isNaN(parseFloat(dateVal)) && /^\d+$/.test(dateVal.trim()))) {
        const num = parseFloat(dateVal);
        // Excel serial dates are usually between 20000 (1954) and 60000 (2064)
        if (num > 20000 && num < 60000) {
            const date = new Date((num - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
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
