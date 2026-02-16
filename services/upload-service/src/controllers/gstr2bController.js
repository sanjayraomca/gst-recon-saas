
const ExcelParser = require('../services/excelParser');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const fs = require('fs');
const knex = require('../../../shared/src/db/connection');
const FileStorageService = require('../services/fileStorageService');
const path = require('path');
const xlsx = require('xlsx'); // Direct require for date parsing if needed

/**
 * Controller for GSTR-2B Excel Import (Simplified)
 * Handles only File Upload & Metadata Storage
 */
class GSTR2BController {
    static async uploadGSTR2B(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            let { period_code, gstin_id, return_period } = req.body; // return_period like '122025'
            if (!return_period && period_code) return_period = period_code;
            const workspaceId = req.headers['x-workspace-id'];

            // Validation attributes
            if (!gstin_id || !return_period) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Missing gstin_id or return_period (MMYYYY)' });
            }

            // 1. Fetch Tenant & GSTIN Details
            const workspace = await knex('workspaces').where({ id: workspaceId }).first();
            if (!workspace) throw new Error('Invalid Workspace ID');

            // Get user email from headers or request (assuming middleware populates it, or pass via body if simpler) 
            // For now, defaulting or extracting from token if available. 
            // If not available, we can query user by ID if 'x-user-id' header exists.
            const userId = req.headers['x-user-id'];
            let userEmail = '';
            if (userId) {
                const user = await knex('users').where({ id: userId }).first();
                if (user) userEmail = user.email;
            }

            const gstinData = await knex('gstin_master').where({ id: gstin_id }).first();
            if (!gstinData) throw new Error('Invalid GSTIN ID');

            const tenantId = workspace.tenant_id;
            const gstin = gstinData.gstin;

            // --- VALIDATION START (Strict Mode Restored) ---
            const extractedGSTIN = ExcelParser.extractGSTIN(req.file.path);
            console.log(`Validation: Selected=${gstin}, Extracted=${extractedGSTIN}`);

            if (extractedGSTIN && extractedGSTIN !== gstin) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({
                    error: 'GSTIN Mismatch',
                    details: `File contains data for ${extractedGSTIN}, but you selected ${gstin}. Please upload the correct file.`
                });
            }
            // --- VALIDATION END ---

            // 2. Calculate Financial Year
            const month = parseInt(return_period.substring(0, 2));
            const year = parseInt(return_period.substring(2));
            let fyStart, fyEnd;
            if (month <= 3) {
                fyStart = year - 1;
                fyEnd = year;
            } else {
                fyStart = year;
                fyEnd = year + 1;
            }
            const financialYear = `${fyStart}-${fyEnd}`;

            // 3. Extract Generation Date
            // Attempt to find "Date of generation" in the first sheet or specific cell
            // Assuming simplified logic: check Read Me sheet if possible, else default to NOW if not found
            let generationDate = new Date();
            try {
                const workbook = xlsx.readFile(req.file.path);
                const firstSheetName = workbook.SheetNames[0]; // Usually 'Read me'
                const worksheet = workbook.Sheets[firstSheetName];
                // Check if we can find a date string. Usually in format "Date of generation : DD/MM/YYYY"
                const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
                for (let row of jsonData) {
                    const rowStr = row.join(' ');
                    if (rowStr.includes('Date of generation')) {
                        // regex to find DD/MM/YYYY
                        const dateMatch = rowStr.match(/(\d{2}\/\d{2}\/\d{4})/);
                        if (dateMatch) {
                            const [day, month, year] = dateMatch[0].split('/');
                            generationDate = new Date(`${year}-${month}-${day}`);
                        }
                        break;
                    }
                }
            } catch (e) {
                console.warn('Failed to extract generation date, using current date', e);
            }

            // 4. Upload to MinIO
            const originalFilename = req.file.originalname;
            const minioPath = `${tenantId}/${gstin}/${financialYear}/Gstr2b/${originalFilename}`;
            const uploadedPath = await FileStorageService.uploadFile(req.file.path, minioPath, req.file.mimetype);

            // 5. Create Entry in gstr_import_master
            // Note: tenant_uuid map to tenantId
            const importData = {
                tenant_uuid: tenantId,
                gstin_recipient: gstin,
                return_period: return_period,
                financial_year: financialYear,
                generation_date: generationDate,
                upload_timestamp: new Date(),
                import_type: 'GSTR2B',
                original_filename: originalFilename,
                uploaded_filepath: uploadedPath,
                uploaded_file_url: uploadedPath,
                extra_info: JSON.stringify({ workspace_id: workspaceId }),
                total_records: 0, // Not processing records now
                status: 'Completed',
                imported_by: userId || null,
                user_email: userEmail
            };

            const [insertedRecord] = await knex('gstr_import_master').insert(importData).returning('filing_id');

            // Cleanup
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            return successResponse(res, {
                message: 'File uploaded and metadata saved successfully',
                filing_id: insertedRecord.filing_id
            }, 'GSTR-2B Import Successful');

        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Import Error:', error);
            return errorResponse(res, error);
        }
    }

    static async getImportHistory(req, res) {
        try {
            const workspaceId = req.headers['x-workspace-id'];
            if (!workspaceId) return res.status(400).json({ error: 'Workspace ID required' });

            // Fetch history for the tenant derived from workspace (or store workspace_id directly in master if needed, currently implicitly via tenant or extra_info)
            // For now, fetching all for the tenant or filtering by extra_info->workspace_id if we want strict workspace isolation
            // Efficient way: Join workspaces to get tenant_id, then query gstr_import_master

            const workspace = await knex('workspaces').where({ id: workspaceId }).first();
            if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

            const history = await knex('gstr_import_master')
                .where({ tenant_uuid: workspace.tenant_id })
                .orderBy('created_at', 'desc')
                .limit(50); // Limit to last 50 for now

            return successResponse(res, history, 'Import history fetched successfully');
        } catch (error) {
            console.error('Fetch History Error:', error);
            return errorResponse(res, error);
        }
    }
}

module.exports = GSTR2BController;

