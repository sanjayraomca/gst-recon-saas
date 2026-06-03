const GSTRImportModel = require('../models/gstrImportModel');
const GstinMasterService = require('../../../shared/src/services/gstinMasterService');
const SupplierMasterService = require('../../../shared/src/services/supplierMasterService');
const NormalizedGstr2bModel = require('../models/normalizedGstr2bModel');
const NormalizedGstr2aModel = require('../models/normalizedGstr2aModel');
const minioClient = require('../utils/minioClient');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
const progressEmitter = require('../utils/progressEmitter');
const { publishEvent } = require('../nats/natsClient');
const db = require('../../../shared/src/db/connection');

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
                generation_date,
            } = req.body;

            const upload_id = req.body.upload_id || null;
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 5, 'Starting validation...');
            }

            // Use user and tenant info from request context (set by auth middleware)
            const userId = req.user?.db_id || req.user?.id;
            const userEmail = req.user?.email;
            let tenantUuid = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];

            if (!userId) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, { message: 'User identity not found in request', isCustom: true }, 401);
            }

            if (!tenantUuid) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, { message: 'Tenant context missing from request', isCustom: true }, 403);
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

            // Ensure Tax Period exists
            await GSTRImportController.ensureTaxPeriodExists(return_period.toString(), db);

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

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 15, 'Validating File format & GSTIN...');
            }

            // 1. Parse & Validate File GSTIN
            const workbook = xlsx.readFile(uploadedFilePath);
            const { validateFileType } = require('../utils/fileValidation');

            const fileTypeValidation = validateFileType(workbook, gstr_type);
            if (!fileTypeValidation.valid) {
                if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
                return errorResponse(res, {
                    message: fileTypeValidation.message,
                    isCustom: true
                }, 400);
            }

            // GSTIN validation from file is removed as per requirement

            // 2. Compute MD5 hash of the uploaded file BEFORE doing anything else
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 25, 'Checking for duplicates...');
            }

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

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 35, 'Uploading to secure storage...');
            }

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
                workspaceId,
                gstinRecipient,
                returnPeriod: return_period,
                financialYear,
                generationDate: generation_date || new Date(),
                importType: gstr_type.toUpperCase(),
                originalFilename: req.file.originalname,
                uploadedFilepath: uploadedFilePath,
                uploadedFileUrl: `http://minio.gst.local:9091/browser/${minioResult.bucket || 'gst-documents'}/${encodeURIComponent(minioResult.objectPath)}`,
                extraInfo: {
                    minioPath: minioResult.objectPath,
                    isUpdate,
                    previousImportFilingId: previousImport?.import_filing_id || null
                },
                importedBy: userId,
                userEmail,
                fileHash
            });


            // PROCESS FILE
            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 50, 'Parsing spreadsheets...');
            }

            let totalInserted = 0;
            let totalSkipped = 0;

            // Per-section counters (Task 6)
            const sectionCounters = { b2b: 0, b2ba: 0, cdnr: 0, cdnra: 0, impg: 0, isd: 0, normalized: 0 };
            const allAddedInvoices = [];
            const allDuplicateInvoices = [];

            // Mark as Processing (Task 7)
            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Processing');

            try {
                const xlsx = require('xlsx');
                const { processB2BSheet, processImportSheet, processISDSheet } = require('../utils/sheetProcessors');

                let totalRecords = 0;

                if (['GSTR2B', 'GSTR-2B', 'GSTR2A', 'GSTR-2A'].includes(gstr_type.toUpperCase())) {
                    const isGstr2a = ['GSTR2A', 'GSTR-2A'].includes(gstr_type.toUpperCase());
                    const NormalizedModel = isGstr2a ? NormalizedGstr2aModel : NormalizedGstr2bModel;

                    // Shared context passed to every normalizer mapper
                    const normCtx = {
                        tenantId: tenantUuid,
                        workspaceId,
                        importFilingId: importRecord.import_filing_id,
                        returnPeriod: return_period
                    };

                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        const jsonRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                        const sName = sheetName.toUpperCase();

                        if (upload_id) {
                            await progressEmitter.emitProgress(upload_id, 60 + Math.min(25, Math.floor(totalRecords / 1000)), `Processing ${sheetName}...`);
                        }

                        console.log(`Processing sheet: ${sheetName} (${sName}) - Rows: ${jsonRows.length}`);

                        if (sName.includes('B2B') || sName.includes('CDNR') || sName.includes('CDN') || sName.includes('DN')) {
                            const sheetRecords = processB2BSheet(jsonRows, null, return_period, sheetName, gstr_type);
                            console.log(`[DEBUG] Extracted ${sheetRecords.length} raw records from ${sheetName} for ${gstr_type}`);
                            if (sheetRecords.length > 0) {
                                console.log(`[DEBUG] Sample record from ${sheetName}:`, JSON.stringify(sheetRecords[0]));
                            }

                            const b2bInvoices = sheetRecords
                                .filter(r => (r.target_table === 'gstr_2b_b2b_invoices' || r.target_table === 'gstr_2a_b2b_invoices') && r.invoice_number && r.invoice_date)
                                .map(r => ({
                                    import_filing_id: importRecord.import_filing_id,
                                    tenant_id: tenantUuid,
                                    workspace_id: workspaceId,
                                    gstin_supplier: r.gstin_supplier,
                                    trade_name: r.trade_name,
                                    invoice_number_raw: r.invoice_number_raw,
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
                                    reconciliation_status: r.reconciliation_status,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    source: r.source,
                                    irn: r.irn,
                                    irn_date: r.irn_date,
                                    return_period: return_period
                                }));

                            const b2baInvoices = sheetRecords
                                .filter(r => (r.target_table === 'gstr_2b_b2ba_invoices' || r.target_table === 'gstr_2a_b2ba_invoices'))
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
                                    reconciliation_status: r.reconciliation_status,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    is_amended: true,
                                    return_period: return_period
                                }));

                            const cdnrNotes = sheetRecords
                                .filter(r => (r.target_table === 'gstr_2b_cdnr' || r.target_table === 'gstr_2a_cdnr'))
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
                                    reconciliation_status: r.reconciliation_status,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    return_period: return_period
                                }));

                            const cdnraNotes = sheetRecords
                                .filter(r => (r.target_table === 'gstr_2b_cdnra' || r.target_table === 'gstr_2a_cdnra'))
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
                                    reconciliation_status: r.reconciliation_status,
                                    itc_availability: r.itc_availability,
                                    itc_availability_reason: r.unavailability_reason,
                                    applicable_tax_rate: r.applicable_tax_rate,
                                    return_period: return_period
                                }));

                            if (b2bInvoices.length > 0) {
                                // Upsert supplier GSTINs into gstin_master
                                const supplierGstins = b2bInvoices.map(r => r.gstin_supplier).filter(Boolean);
                                if (supplierGstins.length > 0) {
                                    await GstinMasterService.ensureMultiple(supplierGstins);

                                    // SMART CAPTURE: Add suppliers to master directory
                                    const uniqueSuppliers = Array.from(new Map(b2bInvoices
                                        .filter(r => r.trade_name || r.gstin_supplier)
                                        .map(r => [r.gstin_supplier || r.trade_name, { gstin: r.gstin_supplier, name: r.trade_name }])
                                    ).values());

                                    if (uniqueSuppliers.length > 0) {
                                        await SupplierMasterService.batchUpsert(workspaceId, uniqueSuppliers);
                                    }
                                }
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'B2B', sheetName);
                                const { inserted, addedInvoices } = isGstr2a
                                    ? await GSTRImportModel.batchInsertB2BInvoices2A(b2bInvoices)
                                    : await GSTRImportModel.batchInsertB2BInvoices(b2bInvoices);

                                const normRows = NormalizedModel.mapB2B(b2bInvoices, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_b2b_invoices' : 'gstr_2b_b2b_invoices'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.b2b += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;

                                // Tracking duplicates
                                const addedSet = new Set(addedInvoices);
                                b2bInvoices.forEach(inv => {
                                    const invObj = {
                                        inv_no: inv.invoice_number || '',
                                        inv_date: inv.invoice_date || ''
                                    };
                                    if (addedSet.has(inv.invoice_number)) {
                                        allAddedInvoices.push(invObj);
                                    } else {
                                        allDuplicateInvoices.push(invObj);
                                    }
                                });

                                const currentSectionSkipped = (b2bInvoices.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += b2bInvoices.length;
                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: b2bInvoices.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
                            }
                            if (b2baInvoices.length > 0) {
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'B2BA', sheetName);
                                const { inserted, addedInvoices } = isGstr2a
                                    ? await GSTRImportModel.batchInsertB2BAInvoices2A(b2baInvoices)
                                    : await GSTRImportModel.batchInsertB2BAInvoices(b2baInvoices);

                                const normRows = NormalizedModel.mapB2BA(b2baInvoices, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_b2ba_invoices' : 'gstr_2b_b2ba_invoices'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.b2ba += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;

                                const addedSet = new Set(addedInvoices);
                                b2baInvoices.forEach(inv => {
                                    const invObj = {
                                        inv_no: inv.revised_invoice_number || '',
                                        inv_date: inv.revised_invoice_date || ''
                                    };
                                    if (addedSet.has(inv.revised_invoice_number)) {
                                        allAddedInvoices.push(invObj);
                                    } else {
                                        allDuplicateInvoices.push(invObj);
                                    }
                                });

                                const currentSectionSkipped = (b2baInvoices.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += b2baInvoices.length;
                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: b2baInvoices.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
                            }
                            if (cdnrNotes.length > 0) {
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'CDNR', sheetName);
                                const { inserted, addedInvoices } = isGstr2a
                                    ? await GSTRImportModel.batchInsertCDNR2A(cdnrNotes)
                                    : await GSTRImportModel.batchInsertCDNR(cdnrNotes);

                                const normRows = NormalizedModel.mapCDNR(cdnrNotes, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_cdnr' : 'gstr_2b_cdnr'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.cdnr += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;

                                const addedSet = new Set(addedInvoices);
                                cdnrNotes.forEach(inv => {
                                    const invObj = {
                                        inv_no: inv.note_number || '',
                                        inv_date: inv.note_date || ''
                                    };
                                    if (addedSet.has(inv.note_number)) {
                                        allAddedInvoices.push(invObj);
                                    } else {
                                        allDuplicateInvoices.push(invObj);
                                    }
                                });

                                const currentSectionSkipped = (cdnrNotes.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += cdnrNotes.length;

                                // SMART CAPTURE: Add suppliers from CDNR to master directory
                                const uniqueCdnrSuppliers = Array.from(new Map(cdnrNotes
                                    .filter(r => r.trade_name || r.gstin_supplier)
                                    .map(r => [r.gstin_supplier || r.trade_name, { gstin: r.gstin_supplier, name: r.trade_name }])
                                ).values());

                                if (uniqueCdnrSuppliers.length > 0) {
                                    await SupplierMasterService.batchUpsert(workspaceId, uniqueCdnrSuppliers);
                                }

                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: cdnrNotes.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
                            }
                            if (cdnraNotes.length > 0) {
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'CDNRA', sheetName);
                                const { inserted } = isGstr2a
                                    ? await GSTRImportModel.batchInsertCDNRA2A(cdnraNotes)
                                    : await GSTRImportModel.batchInsertCDNRA(cdnraNotes);

                                const normRows = NormalizedModel.mapCDNRA(cdnraNotes, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_cdnra' : 'gstr_2b_cdnra'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.cdnra += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;
                                const currentSectionSkipped = (cdnraNotes.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += cdnraNotes.length;
                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: cdnraNotes.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
                            }
                        }
                        else if (sName.includes('IMPG') || sName.includes('IMPS')) {
                            const sheetRecords = processImportSheet(jsonRows, null, return_period, gstr_type);
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
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'IMPG', sheetName);
                                const { inserted } = isGstr2a
                                    ? await GSTRImportModel.batchInsertIMPG2A(impgRecords)
                                    : await GSTRImportModel.batchInsertIMPG(impgRecords);

                                const normRows = NormalizedModel.mapIMPG(impgRecords, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_impg' : 'gstr_2b_impg'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.impg += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;
                                const currentSectionSkipped = (impgRecords.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += impgRecords.length;
                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: impgRecords.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
                            }
                        }
                        else if (sName.includes('ISD')) {
                            const sheetRecords = processISDSheet(jsonRows, null, return_period, sheetName, gstr_type);
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
                                const logId = await GSTRImportModel.createImportLog(importRecord.import_filing_id, 'ISD', sheetName);
                                const { inserted } = isGstr2a
                                    ? await GSTRImportModel.batchInsertISD2A(isdRecords)
                                    : await GSTRImportModel.batchInsertISD(isdRecords);

                                const normRows = NormalizedModel.mapISD(isdRecords, {
                                    ...normCtx,
                                    sourceTable: isGstr2a ? 'gstr_2a_isd' : 'gstr_2b_isd'
                                });

                                const { inserted: normIns, skipped: normSkip = 0 } = await NormalizedModel.batchInsert(normRows);
                                sectionCounters.isd += inserted;
                                sectionCounters.normalized += normIns;
                                totalInserted += inserted;
                                const currentSectionSkipped = (isdRecords.length - inserted) + normSkip;
                                totalSkipped += currentSectionSkipped;
                                totalRecords += isdRecords.length;
                                await GSTRImportModel.finishImportLog(logId, {
                                    rowsFound: isdRecords.length,
                                    rowsInserted: inserted,
                                    rowsSkipped: currentSectionSkipped,
                                    rowsNormalized: normIns
                                });
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

                // Mark as Normalizing then finalize with counters (Tasks 6 & 7)
                await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Normalizing');

                const finalStatus = totalInserted > 0 ? 'Completed' : 'PartiallyCompleted';
                await GSTRImportModel.updateImportStatusWithCounters(
                    importRecord.import_filing_id,
                    sectionCounters,
                    finalStatus,
                    `${totalInserted} inserted, ${totalSkipped} skipped across all sections`
                );

                // Update master record with added/duplicate info in extra_info
                await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, finalStatus, totalInserted, {
                    added_invoices: allAddedInvoices,
                    duplicate_invoices: allDuplicateInvoices
                });

                // Publish Event for Reconciliation Trigger
                if (finalStatus === 'Completed' || finalStatus === 'PartiallyCompleted') {
                    publishEvent('gstr-data-imported', {
                        tenant_id: tenantUuid,
                        workspace_id: workspaceId || null,
                        gstin_id: gstin_id,
                        period: return_period,
                        gstr_type: gstr_type.toUpperCase(),
                        import_id: importRecord.import_filing_id,
                        record_count: totalInserted
                    });
                }

                importRecord.status = finalStatus;
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

            await logActivity({
                userId,
                tenantId: tenantUuid,
                workspaceId: workspaceId || null,
                actionType: 'IMPORT_GSTR_DATA',
                entityType: 'GSTR_Data',
                details: {
                    fileName: req.file.originalname,
                    type: gstr_type.toUpperCase(),
                    recordsInserted: totalInserted,
                    period: return_period,
                    source: 'EXCEL'
                },
                req
            });

            const message = isUpdate
                ? `File processed as update: ${totalInserted} new records added, ${totalSkipped} already existed.`
                : `Import Successful: ${totalInserted} records have been added to the system.`;

            if (upload_id) {
                await progressEmitter.emitProgress(upload_id, 100, 'Completed');
            }

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
                skipped_records: totalSkipped,
                added_invoices: allAddedInvoices,
                duplicate_invoices: allDuplicateInvoices
            }, message);

        } catch (error) {
            // Cleanup on error
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
                fs.unlinkSync(uploadedFilePath);
            }

            if (req.body.upload_id) await progressEmitter.emitProgress(req.body.upload_id, 100, 'Import Failed', true);

            console.error('GSTR Import Error:', error);
            const isValidationError = error.message && error.message.includes('No valid records');
            return errorResponse(res, {
                message: error.message || 'Internal Server Error',
                isCustom: isValidationError
            }, isValidationError ? 400 : 500);
        }
    }

    /**
     * Stream Server-Sent Events (SSE) for upload progress tracking
     * GET /gst-import/import/progress?upload_id=xxx
     */
    static getUploadProgress(req, res) {
        const uploadId = req.query.upload_id;
        if (!uploadId) {
            return res.status(400).json({ success: false, error: 'upload_id is required' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Immediately flush headers so fetch connection resolves
        res.flushHeaders();

        const sendProgress = (data) => {
            if (data.uploadId === uploadId) {
                res.write(`data: ${JSON.stringify({ progress: data.progress, message: data.message, error: data.error })}\n\n`);

                if (data.progress >= 100 || data.error) {
                    // Give frontend time to receive before closing
                    setTimeout(() => res.end(), 1000);
                }
            }
        };

        progressEmitter.on('progress', sendProgress);

        req.on('close', () => {
            progressEmitter.removeListener('progress', sendProgress);
        });
    }

    /**
     * Get import history for current tenant
     * GET /gst-import/import/history
     */
    static async getImportHistory(req, res) {
        try {
            const userEmail = req.user?.email;
            console.log(`[getImportHistory] Request received for email: ${userEmail}, query:`, req.query);

            if (!userEmail) {
                return errorResponse(res, { message: 'User email not found in token' }, 401);
            }

            const userQuery = await db.raw('SELECT id, tenant_id FROM users WHERE email = ?', [userEmail]);

            if (!userQuery.rows || userQuery.rows.length === 0) {
                return errorResponse(res, { message: 'User not found' }, 404);
            }

            let tenantUuid = req.headers['x-tenant-id'] || userQuery.rows[0].tenant_id;
            const { gstin, import_type, status, limit = 50, workspace_id } = req.query;

            // Fallbacks if tenantId is missing
            if (!tenantUuid && workspace_id) {
                const wq = await db.raw('SELECT tenant_id FROM workspaces WHERE id = ?', [workspace_id]);
                if (wq.rows && wq.rows.length > 0) {
                    tenantUuid = wq.rows[0].tenant_id;
                }
            }

            if (!tenantUuid) {
                const tq = await db.raw('SELECT id FROM tenants WHERE owner_user_id = ? LIMIT 1', [userQuery.rows[0].id]);
                if (tq.rows && tq.rows.length > 0) {
                    await db.raw('UPDATE users SET tenant_id = ? WHERE id = ?', [tq.rows[0].id, userQuery.rows[0].id]);
                    tenantUuid = tq.rows[0].id;
                }
            }

            if (!tenantUuid) {
                return errorResponse(res, { message: 'User not associated with any tenant' }, 403);
            }



            const filters = {};
            if (gstin) filters.gstinRecipient = gstin;
            if (import_type) filters.importType = import_type.toUpperCase();
            if (status) filters.status = status;
            if (workspace_id) filters.workspaceId = workspace_id;

            // Allow workspace_id from headers as well for consistency
            const headerWorkspaceId = req.headers['x-workspace-id'];
            if (!filters.workspaceId && headerWorkspaceId) {
                filters.workspaceId = headerWorkspaceId;
            }

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
     * List normalized GSTR-2B invoices (paginated, filterable)
     * GET /gst-import/gstr2b/list
     *
     * Query params:
     *   return_period    MMYYYY
     *   section          B2B | B2BA | CDNR | CDNRA | IMPG | ISD | ISDA
     *   supplier_gstin
     *   document_number
     *   itc_available    true | false
     *   page             default 1
     *   page_size        default 50 (max 500)
     */
    static async listGstr2bInvoices(req, res) {
        try {
            const workspaceId = req.headers['x-workspace-id'];
            if (!workspaceId) {
                return errorResponse(res, { message: 'x-workspace-id header is required', isCustom: true }, 400);
            }

            const {
                return_period,
                section,
                supplier_gstin,
                supplier_name,
                document_number,
                document_number_op,
                search_term,
                min_taxable,
                max_taxable,
                min_tax,
                max_tax,
                min_igst,
                max_igst,
                min_cgst,
                max_cgst,
                min_sgst,
                max_sgst,
                itc_available,
                from_date,
                to_date,
                min_amount,
                max_amount,
                min_net_amount,
                max_net_amount,
                supply_type,
                state_codes,
                sort_by,
                sort_order,
                page,
                page_size,
                import_type,
                column_filters,
            } = req.query;

            const result = await NormalizedGstr2bModel.listInvoices({
                workspaceId,
                returnPeriod: return_period,
                sourceSection: section,
                supplierGstin: supplier_gstin,
                supplierName: supplier_name,
                documentNumber: document_number,
                documentNumberOp: document_number_op,
                searchTerm: search_term,
                minTaxable: min_taxable,
                maxTaxable: max_taxable,
                minTax: min_tax,
                maxTax: max_tax,
                minIgst: min_igst,
                maxIgst: max_igst,
                minCgst: min_cgst,
                maxCgst: max_cgst,
                minSgst: min_sgst,
                maxSgst: max_sgst,
                itcAvailable: itc_available,
                fromDate: from_date,
                toDate: to_date,
                minAmount: min_amount,
                maxAmount: max_amount,
                minNetAmount: min_net_amount,
                maxNetAmount: max_net_amount,
                supplyType: supply_type,
                stateCodes: state_codes,
                sortBy: sort_by,
                sortOrder: sort_order,
                importType: import_type,
                page,
                pageSize: page_size,
                columnFilters: column_filters,
            });

            // --- ACTIVITY LOG ---
            const tenantId = req.user?.tenant_id || req.user?.tenantId || req.headers['x-tenant-id'];
            const displayType = (import_type?.toUpperCase() === 'GSTR2A') ? 'GSTR-2A' : 'GSTR-2B';

            await logActivity({
                userId: req.user?.db_id || req.user?.id || req.user?.sub,
                tenantId: tenantId,
                workspaceId: workspaceId,
                actionType: `VIEW_ALL_${displayType.replace('-', '')}_INVOICES`,
                entityType: 'GSTR_DATA',
                details: {
                    page_name: `${displayType} Register`,
                    filters: req.query,
                    pagination: {
                        page: parseInt(page) || 1,
                        page_size: parseInt(page_size) || 25
                    },
                    record_count: result.rows.length
                },
                req
            });

            return successResponse(res, result, 'Invoices retrieved successfully');

        } catch (error) {
            console.error('[listGstr2bInvoices] Error:', error);
            return errorResponse(res, {
                message: error.message || 'Internal Server Error',
                isCustom: error.message?.includes('required'),
            }, error.message?.includes('required') ? 400 : 500);
        }
    }

    /**
     * Aggregated summary of normalized GSTR-2B invoices grouped by section
     * GET /gst-import/gstr2b/summary
     *
     * Query params:
     *   return_period  MMYYYY
     */
    static async getGstr2bSummary(req, res) {
        try {
            const workspaceId = req.headers['x-workspace-id'];
            if (!workspaceId) {
                return errorResponse(res, { message: 'x-workspace-id header is required', isCustom: true }, 400);
            }

            const {
                return_period,
                section,
                supplier_gstin,
                document_number,
                search_term,
                itc_available,
                from_date,
                to_date,
                min_amount,
                max_amount,
                min_net_amount,
                max_net_amount,
                supply_type,
                state_codes,
                import_type
            } = req.query;

            console.log(`[getGstr2bSummary] Workspace: ${workspaceId}, Period: ${return_period}`);

            const rows = await NormalizedGstr2bModel.getListingSummary({
                workspaceId,
                returnPeriod: return_period,
                sourceSection: section,
                supplierGstin: supplier_gstin,
                documentNumber: document_number,
                searchTerm: search_term,
                itcAvailable: itc_available,
                fromDate: from_date,
                toDate: to_date,
                minAmount: min_amount,
                maxAmount: max_amount,
                minNetAmount: min_net_amount,
                maxNetAmount: max_net_amount,
                supplyType: supply_type,
                stateCodes: state_codes,
                importType: import_type,
            });

            // --- ACTIVITY LOG ---
            if (section?.toUpperCase() === 'ALL' || !section) { // Only log module view for full summaries
                const tenantId = req.user?.tenant_id || req.user?.tenantId || req.headers['x-tenant-id'];
                const displayType = (import_type?.toUpperCase() === 'GSTR2A') ? 'GSTR-2A' : 'GSTR-2B';

                await logActivity({
                    userId: req.user?.db_id || req.user?.id || req.user?.sub,
                    tenantId: tenantId,
                    workspaceId: workspaceId,
                    actionType: `VIEW_${displayType.replace('-', '')}_SUMMARY`,
                    entityType: 'GSTR_DATA',
                    details: {
                        page_name: `${displayType} Summary`,
                        period: return_period,
                        import_type,
                        filters: req.query
                    },
                    req
                });
            }

            return successResponse(res, rows, 'Summary retrieved successfully');

        } catch (error) {
            console.error('[getGstr2bSummary] Error:', error);
            return errorResponse(res, {
                message: error.message || 'Internal Server Error',
                isCustom: error.message?.includes('required'),
            }, error.message?.includes('required') ? 400 : 500);
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

    /**
     * Ensure tax period exists in the database, creating it if necessary.
     */
    static async ensureTaxPeriodExists(returnPeriod, db) {
        const periodMatch = await db.raw('SELECT id FROM tax_periods WHERE period_code = ? LIMIT 1', [returnPeriod]);
        if (periodMatch.rows.length) {
            return periodMatch.rows[0].id;
        }

        console.log(`[ensureTaxPeriodExists] Creating missing tax period: ${returnPeriod}`);
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));
        const fyCode = GSTRImportController.calculateFinancialYear(returnPeriod);

        // 1. Get or Create Financial Year
        let fyId;
        const fyMatch = await db.raw('SELECT id FROM financial_years WHERE fy_code = ? LIMIT 1', [fyCode]);
        if (fyMatch.rows.length) {
            fyId = fyMatch.rows[0].id;
        } else {
            const startYear = parseInt(fyCode.split('-')[0]);
            const startDate = `${startYear}-04-01`;
            const endDate = `${startYear + 1}-03-31`;
            const fyInsert = await db.raw(
                `INSERT INTO financial_years (fy_code, display_name, start_date, end_date) 
                 VALUES (?, ?, ?, ?) RETURNING id`,
                [fyCode, `FY ${fyCode}`, startDate, endDate]
            );
            fyId = fyInsert.rows[0].id;
        }

        // 2. Create Tax Period
        const startDate = `${year}-${returnPeriod.substring(0, 2)}-01`;
        const dateObj = new Date(year, month, 0); // Last day of month
        const endDate = `${year}-${returnPeriod.substring(0, 2)}-${dateObj.getDate()}`;
        const quarter = month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4;
        const displayName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

        const periodInsert = await db.raw(
            `INSERT INTO tax_periods (fy_id, month, year, period_code, display_name, start_date, end_date, period_type, quarter)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'MONTHLY', ?) RETURNING id`,
            [fyId, month, year, returnPeriod, displayName, startDate, endDate, quarter]
        );

        const newId = periodInsert.rows[0].id;

        // 3. Ensure siblings for the quarter exist for UI consistency
        try {
            const fyStartYear = parseInt(fyCode.split('-')[0]);
            let monthsInfo = [];
            if (quarter === 1) monthsInfo = [4, 5, 6].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 2) monthsInfo = [7, 8, 9].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 3) monthsInfo = [10, 11, 12].map(m => ({ m, y: fyStartYear }));
            else if (quarter === 4) monthsInfo = [1, 2, 3].map(m => ({ m, y: fyStartYear + 1 }));

            for (const { m, y } of monthsInfo) {
                const code = `${m.toString().padStart(2, '0')}${y}`;
                if (code === returnPeriod) continue;

                const exists = await db.raw('SELECT id FROM tax_periods WHERE period_code = ? LIMIT 1', [code]);
                if (exists.rows.length === 0) {
                    const mStr = m.toString().padStart(2, '0');
                    const sDate = `${y}-${mStr}-01`;
                    const dObj = new Date(y, m, 0);
                    const eDate = `${y}-${mStr}-${dObj.getDate()}`;
                    const dName = new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

                    await db.raw(
                        `INSERT INTO tax_periods (fy_id, month, year, period_code, display_name, start_date, end_date, period_type, quarter)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'MONTHLY', ?)`,
                        [fyId, m, y, code, dName, sDate, eDate, quarter]
                    );
                }
            }
        } catch (err) {
            console.error('[ensureTaxPeriodExists] Error ensuring quarterly siblings:', err.message);
        }

        return newId;
    }
    /**
     * Get active periods for a workspace
     * GET /gst-import/active-periods
     */
    static async getActivePeriods(req, res) {
        try {
            const workspaceId = req.headers['x-workspace-id'] || req.query.workspace_id;

            if (!workspaceId) {
                return errorResponse(res, { message: 'Workspace ID is required', isCustom: true }, 400);
            }

            const activePeriods = await NormalizedGstr2bModel.getActivePeriods(workspaceId);

            return successResponse(res, activePeriods, 'Active periods retrieved successfully');
        } catch (error) {
            console.error('[getActivePeriods] Error:', error);
            return errorResponse(res, {
                message: error.message || 'Internal Server Error',
                isCustom: error.message?.includes('required'),
            }, error.message?.includes('required') ? 400 : 500);
        }
    }

    /**
     * Get dynamic filter options for multi-selects
     * GET /gst-import/filter-options
     */
    static async getFilterOptions(req, res) {
        try {
            const { workspaceId, return_period, field, import_type } = req.query;

            const finalWorkspaceId = workspaceId || req.headers['x-workspace-id'];
            if (!finalWorkspaceId) {
                return errorResponse(res, { message: 'Workspace ID is required', isCustom: true }, 400);
            }

            if (!field || !['gstins', 'parties'].includes(field)) {
                return errorResponse(res, { message: 'Valid field (gstins or parties) is required', isCustom: true }, 400);
            }

            const options = await NormalizedGstr2bModel.getFilterOptions({
                workspaceId: finalWorkspaceId,
                returnPeriod: return_period,
                field,
                importType: import_type
            });

            return successResponse(res, options, 'Filter options retrieved successfully');
        } catch (error) {
            console.error('[getFilterOptions] Error:', error);
            return errorResponse(res, error);
        }
    }

    /**
     * Download original uploaded import file from MinIO
     * GET /gst-import/import/download/:import_filing_id
     */
    static async downloadImportFile(req, res) {
        try {
            const { import_filing_id } = req.params;
            if (!import_filing_id) {
                return errorResponse(res, { message: 'Import filing ID is required', isCustom: true }, 400);
            }

            const importRecord = await GSTRImportModel.getImportById(import_filing_id);
            if (!importRecord) {
                return errorResponse(res, { message: 'Import record not found', isCustom: true }, 404);
            }

            // Get objectPath from extra_info or parse it from uploaded_file_url
            let objectPath = importRecord.extra_info?.minioPath;
            if (!objectPath && importRecord.uploaded_file_url) {
                // Fallback: extract path from URL
                try {
                    const url = new URL(importRecord.uploaded_file_url);
                    const pathParts = url.pathname.split('/');
                    // Skip "/browser/[bucket]/"
                    if (pathParts.length > 3) {
                        objectPath = decodeURIComponent(pathParts.slice(3).join('/'));
                    }
                } catch (e) {
                    console.warn('[downloadImportFile] Failed to parse uploaded_file_url fallback:', e);
                }
            }

            if (!objectPath) {
                return errorResponse(res, { message: 'Secure file storage path not found for this import', isCustom: true }, 400);
            }

            const originalFilename = importRecord.original_filename || 'downloaded_file';
            let contentType = 'application/octet-stream';
            if (originalFilename.endsWith('.json')) {
                contentType = 'application/json';
            } else if (originalFilename.endsWith('.xlsx')) {
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            } else if (originalFilename.endsWith('.xls')) {
                contentType = 'application/vnd.ms-excel';
            } else if (originalFilename.endsWith('.csv')) {
                contentType = 'text/csv';
            }

            // Fetch from MinIO
            const stream = await minioClient.client.getObject(minioClient.bucketName, objectPath);

            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalFilename)}"`);
            res.setHeader('Content-Type', contentType);

            stream.pipe(res);
        } catch (error) {
            console.error('[downloadImportFile] Error:', error);
            return errorResponse(res, error);
        }
    }

    /**
     * Delete import record (Undo import)
     * DELETE /gst-import/import/:import_filing_id
     */
    static async deleteImport(req, res) {
        try {
            const { import_filing_id } = req.params;
            const userEmail = req.user?.email;

            if (!userEmail) {
                return errorResponse(res, { message: 'User email not found in token' }, 401);
            }

            const importRecord = await GSTRImportModel.getImportById(import_filing_id);
            if (!importRecord) {
                return errorResponse(res, { message: 'Import record not found' }, 404);
            }

            // Perform deletion
            const deleted = await GSTRImportModel.deleteImport(import_filing_id);

            // Log activity
            await logActivity({
                userId: req.user?.db_id || req.user?.id || req.user?.sub,
                tenantId: importRecord.tenant_uuid,
                workspaceId: importRecord.workspace_id || null,
                actionType: 'UNDO_IMPORT',
                entityType: 'ImportRecord',
                details: {
                    import_filing_id,
                    filename: importRecord.original_filename,
                    import_type: importRecord.import_type,
                    records_deleted: importRecord.total_record
                },
                req
            });

            // Trigger reconciliation recalculation by publishing event
            try {
                publishEvent('import-undone', {
                    tenant_id: importRecord.tenant_uuid,
                    workspace_id: importRecord.workspace_id || null,
                    period: importRecord.return_period,
                    import_type: importRecord.import_type,
                    import_id: import_filing_id
                });
            } catch (eventErr) {
                console.warn('[deleteImport] Failed to publish event:', eventErr.message);
            }

            return successResponse(res, deleted, 'Import undone successfully');
        } catch (error) {
            console.error('Delete Import (Undo) Error:', error);
            return errorResponse(res, error);
        }
    }
}

module.exports = GSTRImportController;
