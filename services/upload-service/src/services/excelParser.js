const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Excel Parser for GSTR-2B files
 */
class ExcelParser {
    /**
     * Reads all sheets from an Excel file
     * @param {string} filePath 
     * @returns {Object} { sheetName: data[] }
     */
    static parseAllSheets(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found at ' + filePath);
        }

        const workbook = xlsx.readFile(filePath, {
            cellDates: true,
            cellNF: false,
            cellText: false
        });

        const result = {};

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            // Get data as array of arrays to handle multi-line headers
            const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            result[sheetName] = rows;
        });

        return result;
    }

    /**
     * Detects headers in a sheet by looking for keywords
     * @param {Array[]} rows 
     * @param {string[]} keywords 
     * @returns {number} Header row index or -1
     */
    static findHeaderRow(rows, keywords) {
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const rowStr = rows[i].join(' ').toUpperCase();
            if (keywords.every(kw => rowStr.includes(kw.toUpperCase()))) {
                return i;
            }
        }
        return -1;
    }
    /**
     * Extracts GSTIN from the file (typically in the first few rows of the first sheet)
     * @param {string} filePath 
     * @returns {string|null} Extracted GSTIN or null
     */
    static extractGSTIN(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0]; // Usually first sheet ('Read me' or 'B2B' etc)
            const sheet = workbook.Sheets[sheetName];

            // Read first 10 rows
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' }).slice(0, 10);

            // Regex for GSTIN: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit, 1 letter/digit, 1 digit
            const gstinRegex = /\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}/;

            for (const row of rows) {
                const rowStr = row.join(' ');
                const match = rowStr.match(gstinRegex);
                if (match) {
                    return match[0];
                }
            }
            return null;
        } catch (error) {
            console.error('Error extracting GSTIN:', error);
            return null;
        }
    }
}

module.exports = ExcelParser;
