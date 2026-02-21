const GSTRImportModel = require('../models/gstrImportModel');
const minioClient = require('../utils/minioClient');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');

/**
 * Controller for Generic GSTR Import
 * Handles file upload, MinIO storage, and database tracking for all GSTR types
 */

/**
 * Compute MD5 hash of a file (used for exact duplicate detection)
 * Refactored to be async and stream-based to avoid blocking the event loop
 */
async function computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

class GSTRImportController {
    /**
     * Upload GSTR file (Excel) - Generic handler for all GSTR types
     * POST /gst-import/import/upload
     */
    static async uploadGSTRFile(req, res) {
        let uploadedFilePath = null;

        try {
            // Validate file upload
            if (!req.file) {
                return errorResponse(res, { message: 'No file uploaded' }, 400);
            }

            uploadedFilePath = req.file.path;

            // Extract request data
            const {
                gstr_type,
                return_period,
                gstin_id,
                generation_date
            } = req.body;

            // Get user info from JWT token (set by auth middleware)
            const userEmail = req.user?.email;

            if (!userEmail) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, { message: 'User email not found in token', isCustom: true }, 401);
            }

            // Fetch user details including tenant_id from database
            const db = require('../../../shared/src/db/connection');
            let userId, tenantUuid;

            try {
                const userQuery = await db.raw('SELECT id, tenant_id FROM users WHERE email = ?', [userEmail]);
                if (userQuery.rows && userQuery.rows.length > 0) {
                    userId = userQuery.rows[0].id;
                    tenantUuid = userQuery.rows[0].tenant_id;

                    // Fallback: if tenant_id is NULL, look up via tenants.owner_user_id
                    if (!tenantUuid) {
                        const tenantQuery = await db.raw('SELECT id FROM tenants WHERE owner_user_id = ? LIMIT 1', [userId]);
                        if (tenantQuery.rows && tenantQuery.rows.length > 0) {
                            tenantUuid = tenantQuery.rows[0].id;
                            await db.raw('UPDATE users SET tenant_id = ? WHERE id = ?', [tenantUuid, userId]);
                        }
                    }
                } else {
                    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                        fs.unlinkSync(uploadedFilePath);
                    }
                    return errorResponse(res, { message: 'User not found in database', isCustom: true }, 404);
                }

                if (!tenantUuid) {
                    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                        fs.unlinkSync(uploadedFilePath);
                    }
                    return errorResponse(res, { message: 'User is not associated with any tenant', isCustom: true }, 403);
                }
            } catch (dbError) {
                console.error('Error fetching user details:', dbError);
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, { message: 'Failed to fetch user details from database' }, 500);
            }

            // Validate required fields
            if (!gstr_type || !return_period || !gstin_id) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, {
                    message: 'Missing required fields: gstr_type, return_period, gstin_id',
                    isCustom: true
                }, 400);
            }

            // Validate GSTR type
            const validGSTRTypes = ['GSTR1', 'GSTR2A', 'GSTR2B', 'GSTR3B', 'GSTR4', 'GSTR6', 'GSTR7', 'GSTR8', 'GSTR9', 'GSTR9C'];
            if (!validGSTRTypes.includes(gstr_type.toUpperCase())) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, {
                    message: `Invalid GSTR type. Must be one of: ${validGSTRTypes.join(', ')}`,
                    isCustom: true
                }, 400);
            }

            // Fetch actual GSTIN from database using gstin_id
            let gstinRecipient = null;
            let workspaceId = null;

            try {
                const gstinQuery = await db.raw(
                    'SELECT gm.gstin, w.id as workspace_id FROM gstin_master gm LEFT JOIN workspaces w ON w.gstin_id = gm.id WHERE gm.id = ?',
                    [gstin_id]
                );
                if (gstinQuery.rows && gstinQuery.rows.length > 0) {
                    gstinRecipient = gstinQuery.rows[0].gstin;
                    workspaceId = gstinQuery.rows[0].workspace_id || null;
                } else {
                    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                        fs.unlinkSync(uploadedFilePath);
                    }
                    return errorResponse(res, { message: 'Invalid GSTIN ID - GSTIN not found in database', isCustom: true }, 400);
                }
            } catch (dbError) {
                console.error('Error fetching GSTIN:', dbError);
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, { message: 'Failed to fetch GSTIN from database' }, 500);
            }

            // ─── DUPLICATE DETECTION AND VALIDATION ────────────────────────────────────

            // 1. Parse & Validate File GSTIN
            const workbook = xlsx.readFile(uploadedFilePath);
            const { validateFileGSTIN } = require('../utils/fileValidation');

            if (!validateFileGSTIN(workbook, gstinRecipient)) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                return errorResponse(res, {
                    message: `GSTIN Mismatch: The uploaded file does not appear to belong to the selected Organization (${gstinRecipient}).`,
                    isCustom: true
                }, 400);
            }

            // 2. Compute MD5 hash of the uploaded file BEFORE doing anything else
            const fileHash = await computeFileHash(uploadedFilePath);

            const { exactDuplicate, previousImport } = await GSTRImportModel.checkDuplicateByHash(
                tenantUuid,
                gstinRecipient,
                return_period,
                gstr_type.toUpperCase(),
                fileHash,
                req.file.originalname
            );

            if (exactDuplicate) {
                // Exact same file — reject immediately, no DB record, no MinIO upload
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                    fs.unlinkSync(uploadedFilePath);
                }
                console.log(`[DUPLICATE DETECTED] Exact duplicate of ${previousImport.import_filing_id}. Sending 200 OK.`);
                return successResponse(res, {
                    duplicate: true,
                    previousImport: {
                        import_filing_id: previousImport.import_filing_id,
                        original_filename: previousImport.original_filename,
                        uploaded_at: previousImport.upload_timestamp,
                        total_record: previousImport.total_record,
                        status: previousImport.status
                    }
                }, 'This file has already been imported. No changes were detected.');
            }

            // If previousImport exists but hash is different → updated file, proceed with upsert
            const isUpdate = !!previousImport;
            // ─────────────────────────────────────────────────────────────────────────

            // Calculate financial year from return_period (MMYYYY format)
            const financialYear = GSTRImportController.calculateFinancialYear(return_period);

            // Upload to MinIO (always — each upload gets its own timestamped file)
            const minioMetadata = {
                tenantUuid,
                gstin: gstinRecipient,
                financialYear,
                gstrType: gstr_type.toUpperCase(),
                originalFilename: req.file.originalname,
                returnPeriod: return_period
            };

            const minioResult = await minioClient.uploadFile(uploadedFilePath, minioMetadata);

            if (!minioResult.success) {
                throw new Error('Failed to upload file to MinIO');
            }

            // Create database record (always create a new master record per upload)
            const importRecord = await GSTRImportModel.createImportRecord({
                tenantUuid,
                gstinRecipient,
                returnPeriod: return_period,
                financialYear,
                generationDate: generation_date || new Date(),
                importType: gstr_type.toUpperCase(),
                originalFilename: req.file.originalname,
                uploadedFilepath: uploadedFilePath,
                uploadedFileUrl: minioResult.presignedUrl,
                extraInfo: {
                    minioPath: minioResult.objectPath,
                    isUpdate,
                    previousImportFilingId: previousImport?.import_filing_id || null
                },
                importedBy: userId,
                userEmail,
                fileHash
            });

            // PROCESS FILE — insert only new invoices (ON CONFLICT DO NOTHING handles duplicates)
            let totalInserted = 0;
            let totalSkipped = 0;

            try {
                const xlsx = require('xlsx');
                const { processB2BSheet, processImportSheet, processISDSheet } = require('../utils/sheetProcessors');

                let totalRecords = 0;

                if (['GSTR2B', 'GSTR-2B', 'GSTR2A', 'GSTR-2A'].includes(gstr_type.toUpperCase())) {
                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        const jsonRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                        const sName = sheetName.toUpperCase();

                        console.log(`Processing sheet: ${sheetName} (${sName}) - Rows: ${jsonRows.length}`);

                        if (sName.includes('B2B')) {
                            const sheetRecords = processB2BSheet(jsonRows, null, return_period, sheetName);
                            console.log(`[DEBUG] Extracted ${sheetRecords.length} records from processor for ${sheetName}`);

                            // Separate records by target table
                            const b2bInvoices = sheetRecords
                                .filter(r => r.target_table === 'gstr_2b_b2b_invoices' && r.invoice_number && r.invoice_date)
                                .map(r => ({
                                    import_filing_id: importRecord.import_filing_id,
                                    tenant_id: tenantUuid,
                                    workspace_id: workspaceId,
                                    gstin_supplier: r.gstin_supplier,
                                    trade_name: r.trade_name,
                                    invoice_number: r.invoice_number,
                                    invoice_type: r.invoice_type,
                                    invoice_date: r.invoice_date,
                                    invoice_value: r.invoice_value,
                                    place_of_supply: r.place_of_supply,
                                    reverse_charge: r.reverse_charge === 'Y' ? 'Yes' : 'No',
                                    taxable_value: r.taxable_value,
                                    integrated_tax: r.igst_amount,
                                    central_tax: r.cgst_amount,
                                    state_ut_tax: r.sgst_amount,
                                    cess: r.cess_amount,
                                    supplier_filing_period: r.filing_period,
                                    supplier_filing_date: r.filing_date,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    source: r.source,
                                    irn: r.irn,
                                    irn_date: r.irn_date,
                                    return_period: return_period
                                }));

                            const b2baInvoices = sheetRecords
                                .filter(r => r.target_table === 'gstr_2b_b2ba_invoices')
                                .map(r => ({
                                    import_filing_id: importRecord.import_filing_id,
                                    tenant_id: tenantUuid,
                                    workspace_id: workspaceId,
                                    gstin_supplier: r.gstin_supplier,
                                    trade_name: r.trade_name,
                                    original_invoice_number: r.original_invoice_number,
                                    original_invoice_date: r.original_invoice_date,
                                    revised_invoice_number: r.revised_invoice_number,
                                    revised_invoice_date: r.revised_invoice_date,
                                    invoice_type: r.invoice_type,
                                    invoice_value: r.invoice_value,
                                    place_of_supply: r.place_of_supply,
                                    reverse_charge: r.reverse_charge === 'Y' ? 'Yes' : 'No',
                                    taxable_value: r.taxable_value,
                                    integrated_tax: r.igst_amount,
                                    central_tax: r.cgst_amount,
                                    state_ut_tax: r.sgst_amount,
                                    cess: r.cess_amount,
                                    supplier_filing_period: r.filing_period,
                                    supplier_filing_date: r.filing_date,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    is_amended: true,
                                    return_period: return_period
                                }));

                            const cdnrNotes = sheetRecords
                                .filter(r => r.target_table === 'gstr_2b_cdnr')
                                .map(r => ({
                                    import_filing_id: importRecord.import_filing_id,
                                    tenant_id: tenantUuid,
                                    workspace_id: workspaceId,
                                    gstin_supplier: r.gstin_supplier,
                                    trade_name: r.trade_name,
                                    note_type: r.note_type,
                                    note_number: r.note_number,
                                    note_date: r.note_date,
                                    original_invoice_number: r.original_invoice_number,
                                    original_invoice_date: r.original_invoice_date,
                                    note_value: r.note_value,
                                    place_of_supply: r.place_of_supply,
                                    reverse_charge: r.reverse_charge === 'Y' ? 'Yes' : 'No',
                                    taxable_value: r.taxable_value,
                                    integrated_tax: r.igst_amount,
                                    central_tax: r.cgst_amount,
                                    state_ut_tax: r.sgst_amount,
                                    cess: r.cess_amount,
                                    supplier_filing_period: r.filing_period,
                                    supplier_filing_date: r.filing_date,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    return_period: return_period
                                }));

                            const cdnraNotes = sheetRecords
                                .filter(r => r.target_table === 'gstr_2b_cdnra')
                                .map(r => ({
                                    import_filing_id: importRecord.import_filing_id,
                                    tenant_id: tenantUuid,
                                    workspace_id: workspaceId,
                                    gstin_supplier: r.gstin_supplier,
                                    trade_name: r.trade_name,
                                    original_note_number: r.original_note_number,
                                    original_note_date: r.original_note_date,
                                    revised_note_number: r.revised_note_number,
                                    revised_note_date: r.revised_note_date,
                                    note_type: r.note_type,
                                    original_invoice_number: r.original_invoice_number,
                                    original_invoice_date: r.original_invoice_date,
                                    note_value: r.note_value,
                                    place_of_supply: r.place_of_supply,
                                    reverse_charge: r.reverse_charge === 'Y' ? 'Yes' : 'No',
                                    taxable_value: r.taxable_value,
                                    integrated_tax: r.igst_amount,
                                    central_tax: r.cgst_amount,
                                    state_ut_tax: r.sgst_amount,
                                    cess: r.cess_amount,
                                    supplier_filing_period: r.filing_period,
                                    supplier_filing_date: r.filing_date,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    return_period: return_period
                                }));

                            if (b2bInvoices.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertB2BInvoices(b2bInvoices);
                                totalInserted += inserted;
                                totalSkipped += (b2bInvoices.length - inserted);
                                totalRecords += b2bInvoices.length;
                            }
                            if (b2baInvoices.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertB2BAInvoices(b2baInvoices);
                                totalInserted += inserted;
                                totalSkipped += (b2baInvoices.length - inserted);
                                totalRecords += b2baInvoices.length;
                            }
                            if (cdnrNotes.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertCDNR(cdnrNotes);
                                totalInserted += inserted;
                                totalSkipped += (cdnrNotes.length - inserted);
                                totalRecords += cdnrNotes.length;
                            }
                            if (cdnraNotes.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertCDNRA(cdnraNotes);
                                totalInserted += inserted;
                                totalSkipped += (cdnraNotes.length - inserted);
                                totalRecords += cdnraNotes.length;
                            }
                        }
                        else if (sName.includes('IMPG') || sName.includes('IMPS')) {
                            const sheetRecords = processImportSheet(jsonRows, null, return_period);
                            const impgRecords = sheetRecords.map(r => ({
                                import_filing_id: importRecord.import_filing_id,
                                tenant_id: tenantUuid,
                                workspace_id: workspaceId,
                                port_code: r.port_code,
                                boe_number: r.boe_number,
                                boe_date: r.boe_date,
                                return_period: return_period,
                                icegate_ref_date: r.icegate_ref_date,
                                taxable_value: r.taxable_value,
                                integrated_tax: r.integrated_tax,
                                cess: r.cess,
                                itc_availability: r.itc_availability,
                                itc_availability_reason: r.itc_availability_reason,
                                applicable_tax_rate: r.applicable_tax_rate
                            }));

                            if (impgRecords.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertIMPG(impgRecords);
                                totalInserted += inserted;
                                totalSkipped += (impgRecords.length - inserted);
                                totalRecords += impgRecords.length;
                            }
                        }
                        else if (sName.includes('ISD')) {
                            const sheetRecords = processISDSheet(jsonRows, null, return_period, sheetName);
                            const isdRecords = sheetRecords.map(r => ({
                                import_filing_id: importRecord.import_filing_id,
                                tenant_id: tenantUuid,
                                workspace_id: workspaceId,
                                gstin_isd: r.gstin_isd,
                                isd_name: r.isd_name,
                                document_type: r.document_type,
                                document_number: r.document_number,
                                document_date: r.document_date,
                                return_period: return_period,
                                integrated_tax: r.integrated_tax,
                                central_tax: r.central_tax,
                                state_ut_tax: r.state_ut_tax,
                                cess: r.cess,
                                itc_availability: r.itc_availability,
                                is_amended: r.is_amended,
                                original_document_number: r.original_document_number,
                                original_document_date: r.original_document_date
                            }));

                            if (isdRecords.length > 0) {
                                const { inserted } = await GSTRImportModel.batchInsertISD(isdRecords);
                                totalInserted += inserted;
                                totalSkipped += (isdRecords.length - inserted);
                                totalRecords += isdRecords.length;
                            }
                        }
                    }
                }

                // Fallback row count for non-GSTR2B types
                if (totalRecords === 0 && workbook.SheetNames.length > 0) {
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const range = xlsx.utils.decode_range(sheet['!ref']);
                    totalRecords = Math.max(0, range.e.r - range.s.r);
                    totalInserted = totalRecords;
                }

                if (totalRecords === 0) {
                    throw new Error('No valid records found in the uploaded file. Please ensure the file format is correct and contains data.');
                }

                // Update status to Completed
                // Update status to Completed with detailed stats
                await GSTRImportModel.updateImportStatus(
                    importRecord.import_filing_id,
                    'Completed',
                    totalInserted,   // store inserted count as main record count
                    {
                        minioPath: minioResult.objectPath,
                        isUpdate,
                        previousImportFilingId: previousImport?.import_filing_id || null,
                        summary: {
                            total_processed: totalRecords,
                            inserted: totalInserted,
                            skipped: totalSkipped
                        }
                    }
                );

                importRecord.status = 'Completed';
                importRecord.total_record = totalInserted;

            } catch (processError) {
                console.error('Immediate processing failed:', processError);
                await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed');
                importRecord.status = 'Failed';
            }

            // Cleanup local file
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                fs.unlinkSync(uploadedFilePath);
            }

            const message = isUpdate
                ? `File processed as update: ${totalInserted} new records added, ${totalSkipped} already existed.`
                : `Import Successful: ${totalInserted} records have been added to the system.`;

            return successResponse(res, {
                import_filing_id: importRecord.import_filing_id,
                status: importRecord.status,
                import_type: importRecord.import_type,
                return_period: importRecord.return_period,
                financial_year: importRecord.financial_year,
                file_url: importRecord.uploaded_file_url,
                uploaded_at: importRecord.upload_timestamp,
                total_record: importRecord.total_record,
                is_update: isUpdate,
                new_records: totalInserted,
                skipped_records: totalSkipped
            }, message);

        } catch (error) {
            // Cleanup on error
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                fs.unlinkSync(uploadedFilePath);
            }

            console.error('GSTR Import Error:', error);
            const isValidationError = error.message && error.message.includes('No valid records');
            return errorResponse(res, {
                message: error.message || 'Internal Server Error',
                isCustom: isValidationError
            }, isValidationError ? 400 : 500);
        }
    }

    /**
     * Get import history for current tenant
     * GET /gst-import/import/history
     */
    static async getImportHistory(req, res) {
        try {
            const userEmail = req.user?.email;

            if (!userEmail) {
                return errorResponse(res, { message: 'User email not found in token' }, 401);
            }

            const db = require('../../../shared/src/db/connection');

            const userQuery = await db.raw('SELECT id, tenant_id FROM users WHERE email = ?', [userEmail]);

            if (!userQuery.rows || userQuery.rows.length === 0) {
                return errorResponse(res, { message: 'User not found' }, 404);
            }

            const tenantUuid = userQuery.rows[0].tenant_id ||
                await (async () => {
                    const tq = await db.raw('SELECT id FROM tenants WHERE owner_user_id = ? LIMIT 1', [userQuery.rows[0].id]);
                    if (tq.rows && tq.rows.length > 0) {
                        await db.raw('UPDATE users SET tenant_id = ? WHERE id = ?', [tq.rows[0].id, userQuery.rows[0].id]);
                        return tq.rows[0].id;
                    }
                    return null;
                })();

            if (!tenantUuid) {
                return errorResponse(res, { message: 'User not associated with any tenant' }, 403);
            }

            const { gstin, import_type, status, limit = 50 } = req.query;

            const filters = {};
            if (gstin) filters.gstinRecipient = gstin;
            if (import_type) filters.importType = import_type.toUpperCase();
            if (status) filters.status = status;

            const history = await GSTRImportModel.getImportHistory(
                tenantUuid,
                filters,
                parseInt(limit)
            );

            return successResponse(res, history, 'Import history retrieved successfully');

        } catch (error) {
            console.error('Get Import History Error:', error);
            return errorResponse(res, error);
        }
    }

    /**
     * Get specific import details by import filing ID
     * GET /gst-import/import/:import_filing_id
     */
    static async getImportById(req, res) {
        try {
            const { import_filing_id } = req.params;
            const tenantUuid = req.user?.tenant_id;

            const importRecord = await GSTRImportModel.getImportById(import_filing_id);

            if (!importRecord) {
                return errorResponse(res, { message: 'Import record not found' }, 404);
            }

            if (importRecord.tenant_uuid !== tenantUuid) {
                return errorResponse(res, { message: 'Unauthorized access' }, 403);
            }

            return successResponse(res, importRecord, 'Import details retrieved successfully');

        } catch (error) {
            console.error('Get Import By ID Error:', error);
            return errorResponse(res, error);
        }
    }

    /**
     * Helper: Calculate financial year from return period (MMYYYY)
     */
    static calculateFinancialYear(returnPeriod) {
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));

        if (month >= 4) {
            return `${year}-${(year + 1).toString().substring(2)}`;
        } else {
            return `${year - 1}-${year.toString().substring(2)}`;
        }
    }
}

module.exports = GSTRImportController;
