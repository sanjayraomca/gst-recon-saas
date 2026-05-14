const GSTRImportModel = require('../models/gstrImportModel');
const BookModel = require('../models/bookModel');
const minioClient = require('../utils/minioClient');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const fs = require('fs');
const xlsx = require('xlsx');
const { processSalesSheet, processPurchaseSheet } = require('../utils/bookSheetProcessors');
const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');
const progressEmitter = require('../utils/progressEmitter');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');
const { publishEvent } = require('../nats/natsClient');
const { parseParamQueryFallback } = require('../utils/paramQueryParser');


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

            const { return_period, workspace_id, gstin_id, upload_id } = req.body;
            console.log(`[DEBUG] uploadBookData Params: return_period=${return_period}, workspace_id=${workspace_id}, gstin_id=${gstin_id}`);

            if (!return_period) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                if (upload_id) await progressEmitter.emitProgress(upload_id, 100, 'Missing return_period', true);
                return errorResponse(res, { message: 'return_period is required (MMYYYY)', isCustom: true }, 400);
            }

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 5, 'Validating organization matching...');
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
            let tenantUuid = req.headers['x-tenant-id'] || userQuery.rows[0].tenant_id;

            if (!tenantUuid && activeWorkspaceId) {
                const wq = await db.raw('SELECT tenant_id FROM workspaces WHERE id = ?', [activeWorkspaceId]);
                if (wq.rows && wq.rows.length > 0) {
                    tenantUuid = wq.rows[0].tenant_id;
                }
            }

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

            // taxPeriodId resolution is moved to dynamic per-record mapping below
            const returnPeriodStr = return_period.toString();
            const taxPeriodId = await TaxPeriodService.ensureTaxPeriodExists(returnPeriodStr, db);


            // 6. Duplicate Check by Hash (DISABLED to allow re-uploads)
            console.log(`[DEBUG] Computing file hash for ${uploadedFilePath}`);
            const fileHash = await computeFileHash(uploadedFilePath);
            console.log(`[DEBUG] File hash: ${fileHash}`);
            const IMPORT_TYPE = type === 'SALES' ? 'SALES_REGISTER' : 'PURCHASE_REGISTER';

            // console.log(`[DEBUG] Checking for duplicate import: type=${IMPORT_TYPE}, period=${return_period}`);
            // const { exactDuplicate, previousImport } = await GSTRImportModel.checkDuplicateByHash(
            //     tenantUuid,
            //     'SELF',
            //     return_period,
            //     IMPORT_TYPE,
            //     fileHash,
            //     req.file.originalname
            // );

            // if (exactDuplicate) {
            //     console.log(`[DEBUG] Exact duplicate found: ${previousImport.import_filing_id}`);
            //     if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            //     return successResponse(res, { duplicate: true, previousImport }, 'File already imported.');
            // }

            // 7. Parse & Validate File GSTIN
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 20, 'Validating File format & GSTIN...');
            }

            // Yield event loop to ensure SSE connects if fired simultaneously
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log(`[DEBUG] Reading workbook from ${uploadedFilePath}`);
            const workbook = xlsx.readFile(uploadedFilePath);
            const { validateFileType } = require('../utils/fileValidation');

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

            // GSTIN validation from file is removed as per requirement



            // 8. Upload to MinIO
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 35, 'Uploading to secure storage...');
            }

            console.log(`[DEBUG] Calculating financial year for ${return_period}`);
            const financialYear = TaxPeriodService.calculateFinancialYear(return_period);

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
                workspaceId: workspaceUuid,
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
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 45, 'Extracting sheets...');
            }

            const sheetName = workbook.SheetNames[0];
            console.log(`[DEBUG] Processing first sheet: ${sheetName}`);
            let jsonRows = sheetName ? xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) : null;

            if (!jsonRows || jsonRows.length < 2) {
                console.log(`[DEBUG] Standard parser returned empty, attempting ParamQuery fallback parser...`);
                const fallbackRows = parseParamQueryFallback(uploadedFilePath);
                if (fallbackRows && fallbackRows.length >= 2) {
                    jsonRows = fallbackRows;
                }
            }

            console.log(`[DEBUG] Total rows read from sheet: ${jsonRows ? jsonRows.length : 0}`);

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 60, 'Validating & formatting records...');
            }

            let result;
            if (type === 'SALES' || type === 'SALES_RETURN') {
                console.log(`[DEBUG] Starting processSalesSheet for ` + type);
                const invoices = processSalesSheet(jsonRows, tenantUuid, workspaceUuid, null, null, expectedGstin, type);
                console.log(`[DEBUG] processSalesSheet completed. Count=${invoices.length}`);

                await BookImportController.assignDynamicPeriods(invoices, db);

                if (upload_id) {
                    await progressEmitter.emitProgress(upload_id, 85, 'Saving records to database...');
                }
                result = await BookModel.bulkInsertSales(invoices);
            } else if (type === 'PURCHASE' || type === 'PURCHASE_RETURN') {
                console.log(`[DEBUG] Starting processPurchaseSheet for ` + type);
                const vouchers = processPurchaseSheet(jsonRows, tenantUuid, workspaceUuid, null, null, expectedGstin, type);
                console.log(`[DEBUG] processPurchaseSheet completed. Count=${vouchers.length}`);

                await BookImportController.assignDynamicPeriods(vouchers, db);

                if (upload_id) {
                    await progressEmitter.emitProgress(upload_id, 85, 'Saving records to database...');
                }
                result = await BookModel.bulkInsertPurchase(vouchers);
            }
            console.log(`[DEBUG] DB insertion completed. inserted=${result.inserted}`);

            if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
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
                minioPath: minioResult.objectPath,
                added_invoices: result.addedInvoices,
                duplicate_invoices: result.duplicateInvoices
            });

            // Publish Event for Reconciliation Trigger
            publishEvent('book-data-imported', {
                tenant_id: tenantUuid,
                workspace_id: workspaceUuid || workspace_id,
                gstin_id: gstin_id,
                period: return_period,
                type: type.toUpperCase(),
                count: result.inserted
            });

            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);

            await logActivity({
                userId,
                tenantId: tenantUuid,
                workspaceId: workspaceUuid,
                actionType: `${type.toUpperCase()}_IMPORT`,
                entityType: 'BookData',
                details: { fileName: req.file.originalname, recordsInserted: result.inserted, period: return_period },
                req
            });

            const message = `Import Successful: ${result.inserted} records have been added to your ${type.toLowerCase()} register, and ${result.duplicateInvoices.length} duplicates were skipped/updated.`;

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 100, 'Completed');
            }

            return successResponse(res, {
                message,
                total_records: result.inserted,
                added_invoices: result.addedInvoices,
                duplicate_invoices: result.duplicateInvoices,
                import_id: importRecord.import_filing_id
            }, message);

        } catch (error) {
            if (req.body.upload_id) await progressEmitter.emitProgress(req.body.upload_id, 100, 'Import Failed', true);
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



    /**
     * Iterates over processed documents and assigns tax_period_id and filing_period
     * dynamically based on the invoice_date.
     */
    static async assignDynamicPeriods(documents, db) {
        const periodCache = {};
        for (const doc of documents) {
            // Check all possible date fields produced by different mappers
            const dateStr = doc.header.book_vchr_date ||
                doc.header.invoice_date ||
                doc.header.supplier_invoice_date ||
                doc.header.vchr_date ||
                doc.header.date;

            if (dateStr && typeof dateStr === 'string' && dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts.length >= 2) {
                    const yyyy = parts[0];
                    const mm = parts[1];

                    if (yyyy !== 'NaN' && mm !== 'NaN') {
                        const mmyyyy = `${mm}${yyyy}`;
                        if (!periodCache[mmyyyy]) {
                            console.log(`[DEBUG] Resolving tax period for mmyyyy=${mmyyyy} from dateStr=${dateStr}`);
                            periodCache[mmyyyy] = await TaxPeriodService.ensureTaxPeriodExists(mmyyyy, db);
                        }
                        doc.header.tax_period_id = periodCache[mmyyyy];
                        // Only override filing_period if the sheet did NOT provide one
                        if (!doc.header.filing_period) {
                            doc.header.filing_period = mmyyyy;
                        }
                    } else {
                        console.warn(`[DEBUG] Skipping dynamic period resolution for invalid parts: yyyy=${yyyy}, mm=${mm}, dateStr=${dateStr}`);
                    }
                }
            } else {
                console.log(`[DEBUG] Skipping dynamic period resolution: dateStr=${dateStr}`);
            }
        }
    }
}

module.exports = BookImportController;
