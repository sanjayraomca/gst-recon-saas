const GSTR2BModel = require('../models/gstr2bModel');
const ExcelParser = require('../services/excelParser');
const {
    processB2BSheet,
    processSummarySheet,
    processImportSheet,
    processISDSheet
} = require('../utils/sheetProcessors');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const fs = require('fs');
const path = require('path');

/**
 * Controller for GSTR-2B Excel Import
 */
class GSTR2BController {
    /**
     * Handle GSTR-2B Excel Upload and Processing
     */
    static async uploadGSTR2B(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            const { period_code, gstin_id } = req.body;
            const workspaceId = req.headers['x-workspace-id'];

            if (!workspaceId || !period_code || !gstin_id) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Missing workspaceId, period_code or gstin_id' });
            }

            // Get Period ID from DB
            const periodId = await GSTR2BModel.getTaxPeriodId(period_code);
            if (!periodId) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(404).json({ error: `Tax period ${period_code} not found. Please create it first.` });
            }

            // Parse File
            const allSheets = ExcelParser.parseAllSheets(req.file.path);

            const results = {
                invoices: 0,
                summaries: 0,
                imports: 0,
                isd: 0,
                processedSheets: []
            };

            // Process Sheets sequentially

            // 1. Transactional Sheets (Invoices, CDNR, ECO, Reversals, Rejected)
            const transactionSheets = [
                { name: 'B2B', flags: {} },
                { name: 'B2BA', flags: {} },
                { name: 'B2B-CDNR', flags: {} },
                { name: 'B2B-CDNRA', flags: {} },
                { name: 'ECO', flags: {} },
                { name: 'ECOA', flags: {} },
                { name: 'Debit notes (Original)', flags: {} },
                { name: 'B2B-DNRA', flags: {} },
                // Reversal Sheets
                { name: 'B2B (ITC Reversal)', flags: { is_reversal: true } },
                { name: 'B2BA (ITC Reversal)', flags: { is_reversal: true } },
                // Rejected Sheets
                { name: 'B2B(Rejected)', flags: { is_rejected: true } },
                { name: 'B2BA(Rejected)', flags: { is_rejected: true } },
                { name: 'B2B-CDNR(Rejected)', flags: { is_rejected: true } },
                { name: 'B2B-CDNRA(Rejected)', flags: { is_rejected: true } },
                { name: 'ECO(Rejected)', flags: { is_rejected: true } },
                { name: 'ECOA(Rejected)', flags: { is_rejected: true } }
            ];

            for (const sheet of transactionSheets) {
                if (allSheets[sheet.name]) {
                    const invoices = processB2BSheet(allSheets[sheet.name], workspaceId, gstin_id, periodId, sheet.name, sheet.flags);
                    if (invoices.length > 0) {
                        await GSTR2BModel.insertInvoices(invoices);
                        results.invoices += invoices.length;
                        results.processedSheets.push(sheet.name);
                    }
                }
            }

            // 2. Summary Sheets
            const summaryMappings = {
                'ITC Available': 'ITC_AVAILABLE',
                'ITC not available': 'ITC_NOT_AVAILABLE',
                'ITC Reversal': 'ITC_REVERSAL',
                'ITC Rejected': 'ITC_REJECTED'
            };

            for (const [sheetName, type] of Object.entries(summaryMappings)) {
                if (allSheets[sheetName]) {
                    const summaries = processSummarySheet(allSheets[sheetName], workspaceId, periodId, type);
                    if (summaries.length > 0) {
                        await GSTR2BModel.insertSummaries(summaries);
                        results.summaries += summaries.length;
                        results.processedSheets.push(sheetName);
                    }
                }
            }

            // 3. Import Sheets
            if (allSheets['IMPG']) {
                const imports = processImportSheet(allSheets['IMPG'], workspaceId, periodId, false);
                await GSTR2BModel.insertImports(imports);
                results.imports += imports.length;
                results.processedSheets.push('IMPG');
            }
            if (allSheets['IMPGSEZ']) {
                const sezImports = processImportSheet(allSheets['IMPGSEZ'], workspaceId, periodId, true);
                await GSTR2BModel.insertImports(sezImports);
                results.imports += sezImports.length;
                results.processedSheets.push('IMPGSEZ');
            }

            // 4. ISD Sheets
            const isdSheets = [
                { name: 'ISD', amended: false, rejected: false },
                { name: 'ISDA', amended: true, rejected: false },
                { name: 'ISD(Rejected)', amended: false, rejected: true },
                { name: 'ISDA(Rejected)', amended: true, rejected: true }
            ];

            for (const isdSheet of isdSheets) {
                if (allSheets[isdSheet.name]) {
                    const isdData = processISDSheet(allSheets[isdSheet.name], workspaceId, periodId, isdSheet.amended);
                    // Add rejected flag to data if needed
                    if (isdSheet.rejected) {
                        isdData.forEach(d => d.is_rejected = true);
                    }
                    if (isdData.length > 0) {
                        await GSTR2BModel.insertISDCredits(isdData);
                        results.isd += isdData.length;
                        results.processedSheets.push(isdSheet.name);
                    }
                }
            }

            // Cleanup
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            return successResponse(res, results, 'GSTR-2B data imported successfully');

        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('GSTR-2B Import Error:', error);
            return errorResponse(res, error);
        }
    }
}

module.exports = GSTR2BController;
