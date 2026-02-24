const GSTRImportModel = require('../models/gstrImportModel');
const BookModel = require('../models/bookModel');
const minioClient = require('../utils/minioClient');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const fs = require('fs');
const xlsx = require('xlsx');
const { processSalesSheet, processPurchaseSheet } = require('../utils/bookSheetProcessors');
const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');

async function computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

class BookImportController {

    static async uploadBookData(req, res, type) {
        console.log(`[DEBUG] BookImportController.uploadBookData started: type=${type}`);
        let uploadedFilePath = null;

        try {
            if (!req.file) {
                return errorResponse(res, { message: 'No file uploaded', isCustom: true }, 400);
            }
            uploadedFilePath = req.file.path;

            const { return_period, workspace_id, gstin_id } = req.body;
            if (!return_period) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, { message: 'return_period is required (MMYYYY)', isCustom: true }, 400);
            }

            const activeGstinId = gstin_id || null;
            const activeWorkspaceId = workspace_id || null;

            const userEmail = req.user?.email;
            if (!userEmail) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, { message: 'User email not found in token', isCustom: true }, 401);
            }

            // 1. Fetch User & Tenant
            const userQuery = await db.raw('SELECT id, tenant_id FROM users WHERE email = ?', [userEmail]);
            if (!userQuery.rows.length) throw new Error('User not found');

            let userId = userQuery.rows[0].id;
            let tenantUuid = userQuery.rows[0].tenant_id;

            if (!tenantUuid) {
                const tq = await db.raw('SELECT id FROM tenants WHERE owner_user_id = ? LIMIT 1', [userId]);
                if (tq.rows.length) {
                    tenantUuid = tq.rows[0].id;
                    await db.raw('UPDATE users SET tenant_id = ? WHERE id = ?', [tenantUuid, userId]);
                } else {
                    throw new Error('User not associated with any tenant');
                }
            }

            // 5. Fetch Workspace & Expected GSTIN for Validation
            let expectedGstin = null;
            let workspaceUuid = activeWorkspaceId;

            if (activeGstinId) {
                const gq = await db.raw(
                    'SELECT gm.gstin, w.id as workspace_id FROM gstin_master gm LEFT JOIN workspaces w ON w.gstin_id = gm.id WHERE gm.id = ?',
                    [activeGstinId]
                );
                if (gq.rows.length) {
                    expectedGstin = gq.rows[0].gstin;
                    workspaceUuid = workspaceUuid || gq.rows[0].workspace_id;
                }
            } else if (workspaceUuid) {
                const wgq = await db.raw(
                    'SELECT gm.gstin FROM workspaces w JOIN gstin_master gm ON w.gstin_id = gm.id WHERE w.id = ?',
                    [workspaceUuid]
                );
                if (wgq.rows.length) {
                    expectedGstin = wgq.rows[0].gstin;
                }
            }

            if (!expectedGstin) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, {
                    message: 'Organization GSTIN or Workspace not found. Please ensure you have selected an organization.',
                    isCustom: true
                }, 400);
            }

            if (!workspaceUuid) {
                const wq = await db.raw('SELECT id FROM workspaces WHERE tenant_id = ? LIMIT 1', [tenantUuid]);
                if (wq.rows.length) {
                    workspaceUuid = wq.rows[0].id;
                } else {
                    throw new Error('No workspace found for tenant');
                }
            }

            // 3. Resolve Tax Period ID
            let taxPeriodId = null;
            const periodMatch = await db.raw('SELECT id FROM tax_periods WHERE period_code = ? LIMIT 1', [return_period]);
            if (periodMatch.rows.length) {
                taxPeriodId = periodMatch.rows[0].id;
            }

            // 6. Duplicate Check by Hash
            console.log(`[DEBUG] Computing file hash for ${uploadedFilePath}`);
            const fileHash = await computeFileHash(uploadedFilePath);
            console.log(`[DEBUG] File hash: ${fileHash}`);
            const IMPORT_TYPE = type === 'SALES' ? 'SALES_REGISTER' : 'PURCHASE_REGISTER';

            console.log(`[DEBUG] Checking for duplicate import: type=${IMPORT_TYPE}, period=${return_period}`);
            const { exactDuplicate, previousImport } = await GSTRImportModel.checkDuplicateByHash(
                tenantUuid,
                'SELF',
                return_period,
                IMPORT_TYPE,
                fileHash,
                req.file.originalname
            );

            if (exactDuplicate) {
                console.log(`[DEBUG] Exact duplicate found: ${previousImport.import_filing_id}`);
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return successResponse(res, { duplicate: true, previousImport }, 'File already imported.');
            }

            // 7. Parse & Validate File GSTIN
            console.log(`[DEBUG] Reading workbook from ${uploadedFilePath}`);
            const workbook = xlsx.readFile(uploadedFilePath);
            const { validateFileGSTIN, validateFileType } = require('../utils/fileValidation');

            console.log(`[DEBUG] Validating file type: expected=${type}`);
            const fileTypeValidation = validateFileType(workbook, type);
            if (!fileTypeValidation.valid) {
                console.log(`[DEBUG] File type validation failed: ${fileTypeValidation.message}`);
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, {
                    message: fileTypeValidation.message,
                    isCustom: true
                }, 400);
            }

            console.log(`[DEBUG] Validating organization GSTIN: expected=${expectedGstin}`);
            if (!validateFileGSTIN(workbook, expectedGstin)) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, {
                    message: `GSTIN Mismatch: The uploaded file does not appear to belong to the selected Organization (${expectedGstin}).`,
                    isCustom: true
                }, 400);
            }


            // 8. Upload to MinIO
            console.log(`[DEBUG] Calculating financial year for ${return_period}`);
            const financialYear = BookImportController.calculateFinancialYear(return_period);
            const minioMetadata = {
                tenantUuid,
                gstin: 'SELF',
                financialYear,
                gstrType: IMPORT_TYPE,
                originalFilename: req.file.originalname,
                returnPeriod: return_period
            };
            console.log(`[DEBUG] Uploading to MinIO: ${req.file.originalname}`);
            const minioResult = await minioClient.uploadFile(uploadedFilePath, minioMetadata);
            console.log(`[DEBUG] MinIO upload successful: ${minioResult.objectPath}`);

            // 9. Create Import Record
            console.log(`[DEBUG] Creating database import record`);
            const importRecord = await GSTRImportModel.createImportRecord({
                tenantUuid,
                gstinRecipient: 'SELF',
                returnPeriod: return_period,
                financialYear,
                generationDate: new Date(),
                importType: IMPORT_TYPE,
                originalFilename: req.file.originalname || 'unknown_file',
                uploadedFilepath: uploadedFilePath,
                uploadedFileUrl: minioResult.presignedUrl,
                extraInfo: { minioPath: minioResult.objectPath },
                importedBy: userId,
                userEmail,
                fileHash
            });
            console.log(`[DEBUG] Import record created: ${importRecord.import_filing_id}`);

            // 2. Validate Document Type
            const validTypes = ['SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN'];
            if (!validTypes.includes(type.toUpperCase())) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, { message: `Invalid import type: ${type}`, isCustom: true }, 400);
            }

            // 10. Process
            const sheetName = workbook.SheetNames[0];
            console.log(`[DEBUG] Processing first sheet: ${sheetName}`);
            const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
            console.log(`[DEBUG] Total rows read from sheet: ${jsonRows.length}`);

            let result;
            if (type === 'SALES' || type === 'SALES_RETURN') {
                console.log(`[DEBUG] Starting processSalesSheet for ` + type);
                const invoices = processSalesSheet(jsonRows, tenantUuid, workspaceUuid, taxPeriodId, return_period, expectedGstin, type);
                console.log(`[DEBUG] processSalesSheet completed. Count=${invoices.length}`);
                result = await BookModel.bulkInsertSales(invoices);
            } else if (type === 'PURCHASE' || type === 'PURCHASE_RETURN') {
                console.log(`[DEBUG] Starting processPurchaseSheet for ` + type);
                const vouchers = processPurchaseSheet(jsonRows, tenantUuid, workspaceUuid, taxPeriodId, return_period, expectedGstin, type);
                console.log(`[DEBUG] processPurchaseSheet completed. Count=${vouchers.length}`);
                result = await BookModel.bulkInsertPurchase(vouchers);
            }
            console.log(`[DEBUG] DB insertion completed. inserted=${result.inserted}`);

            if (result.inserted === 0) {
                await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                    minioPath: minioResult.objectPath,
                    reason: 'No valid records found in file'
                });
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, {
                    message: `No valid records found in the uploaded file. Please ensure you are using the correct template and data is properly formatted.`,
                    isCustom: true
                }, 400);
            }

            // 8. Update Status
            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Completed', result.inserted, {
                minioPath: minioResult.objectPath
            });

            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);

            const message = `Import Successful: ${result.inserted} records have been added to your ${type.toLowerCase()} register.`;

            return successResponse(res, {
                message,
                total_records: result.inserted,
                import_id: importRecord.import_filing_id
            }, message);

        } catch (error) {
            console.error('Book Import Error:', error);
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            const isCustom = error.message && error.message.includes('No valid records');
            return errorResponse(res, { message: error.message, isCustom: isCustom }, isCustom ? 400 : 500);
        }
    }

    static async uploadSalesBook(req, res) {
        return BookImportController.uploadBookData(req, res, 'SALES');
    }

    static async uploadPurchaseBook(req, res) {
        return BookImportController.uploadBookData(req, res, 'PURCHASE');
    }

    static async uploadSalesReturn(req, res) {
        return BookImportController.uploadBookData(req, res, 'SALES_RETURN');
    }

    static async uploadPurchaseReturn(req, res) {
        return BookImportController.uploadBookData(req, res, 'PURCHASE_RETURN');
    }

    static calculateFinancialYear(returnPeriod) {
        if (!returnPeriod || returnPeriod.length < 6) return 'N/A';
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));
        if (month >= 4) return `${year}-${(year + 1).toString().substring(2)}`;
        else return `${year - 1}-${year.toString().substring(2)}`;
    }
}

module.exports = BookImportController;
