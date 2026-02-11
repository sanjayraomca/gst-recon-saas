
const GSTR2BModel = require('../models/gstr2bModel');
const ExcelParser = require('../services/excelParser');
const {
    processB2BSheet,
    processImportSheet
} = require('../utils/sheetProcessors');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const fs = require('fs');

/**
 * Controller for GSTR-2B Excel Import
 * Updated for Multi-Table Schema
 */
class GSTR2BController {
    static async uploadGSTR2B(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            let { period_code, gstin_id, return_period } = req.body; // return_period like '122025'
            if (!return_period && period_code) return_period = period_code;
            const workspaceId = req.headers['x-workspace-id'];

            // Validation
            if (!gstin_id || !return_period) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Missing gstin_id or return_period (MMYYYY)' });
            }

            // Parse File
            const allSheets = ExcelParser.parseAllSheets(req.file.path);

            // Track processing
            const results = {
                b2b: 0,
                cdnr: 0,
                amendments: 0,
                impg: 0,
                sheets_processed: []
            };

            const sheetGroups = {
                'B2B': allSheets['B2B'],
                'B2BA': allSheets['B2BA'],
                'B2B-CDNR': allSheets['B2B-CDNR'] || allSheets['CDNR'],
                'B2B-CDNRA': allSheets['B2B-CDNRA'] || allSheets['CDNRA'],
                'ECO': allSheets['ECO'], // Treat as B2B usually? Or separate? Doc implies B2B table has eco_gstin column.
                'IMPG': allSheets['IMPG'],
                'IMPGSEZ': allSheets['IMPGSEZ'],
                // Add Rejected/Reversal sheets mapping if needed
            };

            // Container for bulk inserts
            const bulkData = {
                gstr_2b_b2b_invoices: [],
                gstr_2b_cdnr: [],
                gstr_2b_b2ba_amendments: [],
                gstr_2b_impg: []
            };

            // Process B2B/CDNR Types
            const b2bSheets = ['B2B', 'B2BA', 'B2B-CDNR', 'B2B-CDNRA', 'ECO'];

            for (const sheetName of b2bSheets) {
                if (allSheets[sheetName]) {
                    const sheetData = processB2BSheet(allSheets[sheetName], gstin_id, return_period, sheetName);

                    // Route to correct buckets
                    sheetData.forEach(record => {
                        if (record.target_table && bulkData[record.target_table]) {
                            // Remove target_table key before insert
                            const { target_table, ...dbRecord } = record;
                            bulkData[target_table].push(dbRecord);
                        }
                    });
                    results.sheets_processed.push(sheetName);
                }
            }

            // Process Imports
            const importSheets = ['IMPG', 'IMPGSEZ'];
            for (const sheetName of importSheets) {
                if (allSheets[sheetName]) {
                    const sheetData = processImportSheet(allSheets[sheetName], gstin_id, return_period);
                    sheetData.forEach(record => {
                        const { target_table, ...dbRecord } = record;
                        if (bulkData.gstr_2b_impg) bulkData.gstr_2b_impg.push(dbRecord);
                    });
                    results.sheets_processed.push(sheetName);
                }
            }

            // Perform Inserts via Model
            // Using transactions in Model
            await GSTR2BModel.bulkInsertNewSchema(bulkData);

            results.b2b = bulkData.gstr_2b_b2b_invoices.length;
            results.cdnr = bulkData.gstr_2b_cdnr.length;
            results.amendments = bulkData.gstr_2b_b2ba_amendments.length;
            results.impg = bulkData.gstr_2b_impg.length;

            // Cleanup
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            return successResponse(res, results, 'GSTR-2B Import Successful');

        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Import Error:', error);
            return errorResponse(res, error);
        }
    }
}

module.exports = GSTR2BController;
