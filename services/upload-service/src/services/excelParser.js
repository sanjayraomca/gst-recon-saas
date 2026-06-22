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
}

module.exports = ExcelParser;
