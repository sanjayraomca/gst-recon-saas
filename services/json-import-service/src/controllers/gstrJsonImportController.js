const GSTRImportModel = require('../models/gstrImportModel');
const NormalizedGstr2bModel = require('../models/normalizedGstr2bModel');
const SupplierMasterService = require('../../../shared/src/services/supplierMasterService');
const CustomerMasterService = require('../../../shared/src/services/customerMasterService');
const { processGstrJson } = require('../utils/gstrJsonProcessors');
const { publishEvent } = require('../nats/natsClient');
const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');
const minioClient = require('../utils/minioClient');

/**
 * Controller for GSTR JSON Data Import
 */
class GstrJsonImportController {
    /**
     * POST /json-import/gstr/upload
     * Expects: { data: Object, gstinId: String, returnPeriod: String, gstrType: String }
     */
    static async uploadGstrJson(req, res) {
        try {
            const { data, gstinId, returnPeriod, gstrType } = req.body;
            const { tenant_id: userTenantId, email, sub: authSub, id: authId } = req.user;
            
            // Log for debugging
            console.log(`[GstrJsonImport] Processing import for GSTIN/Workspace: ${gstinId}, Period: ${returnPeriod}`);

            // 1. Fetch GSTIN and Workspace info
            let gstinRecipient = null;
            let workspaceId = gstinId;

            //  console.log(`[GstrJsonImport] Resolving context for workspaceId/gstinId: ${workspaceId}`);

            const gstinQuery = await db.raw(
                'SELECT gm.gstin, w.tenant_id, w.id as workspace_id FROM gstin_master gm JOIN workspaces w ON w.gstin_id = gm.id WHERE w.id = ? OR gm.id = ?',
                [workspaceId, workspaceId]
            );

            //  console.log(`[GstrJsonImport] gstinQuery rows count: ${gstinQuery.rows?.length || 0}`);

            let resolvedTenantId = userTenantId;

            if (gstinQuery.rows && gstinQuery.rows.length > 0) {
                // Use the first match
                const match = gstinQuery.rows.find(r => r.workspace_id === workspaceId) || gstinQuery.rows[0];
                gstinRecipient = match.gstin;
                workspaceId = match.workspace_id; // Ensure we use the workspace UUID

                //   console.log(`[GstrJsonImport] Found match: GSTIN=${gstinRecipient}, Workspace=${workspaceId}, Tenant=${match.tenant_id}`);

                // If tenant_id missing in token, use the one from workspace
                if (!resolvedTenantId) {
                    resolvedTenantId = match.tenant_id;
                }
            } else {
                //   console.error(`[GstrJsonImport] No match found for ID: ${workspaceId}. Body:`, req.body);
                return res.status(400).json({ success: false, error: 'Invalid GSTIN or Workspace ID. Please ensure the workspace exists.' });
            }

            // 2. Resolve internal userId if unknown
            let userId = req.user.db_id;
            if (!userId) {
                const subToUse = authSub || authId;
                const userRec = await db('users').where('auth_provider_id', subToUse).select('id').first();
                userId = userRec ? userRec.id : subToUse;
            }

            // 3. Process data into internal format
            const flatRecords = processGstrJson(data, gstrType);

            if (flatRecords.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // 4. Compute Hash for duplicate detection
            const fileHash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');

            // 4.5 Capture Suppliers/Customers in Master Directory (Smart Capture)
            const isSales = gstrType.toUpperCase() === 'GSTR1';
            const uniqueParties = Array.from(new Map(flatRecords
                .filter(r => r.supplier_name || r.trade_name)
                .map(r => {
                    const gstin = r.supplier_gstin || r.gstin_supplier;
                    const name = r.supplier_name || r.trade_name;
                    return [gstin || name, { gstin, name }];
                })
            ).values());
            
            if (uniqueParties.length > 0) {
                if (isSales) {
                    await CustomerMasterService.batchUpsert(workspaceId, uniqueParties);
                } else {
                    await SupplierMasterService.batchUpsert(workspaceId, uniqueParties);
                }
            }

            // 5. Check for exact duplicate file (same hash)
            const duplicateCheck = await GSTRImportModel.checkDuplicateByHash(
                resolvedTenantId,
                gstinRecipient,
                returnPeriod,
                gstrType.toUpperCase(),
                fileHash,
                `json_import_${Date.now()}.json`
            );

            if (duplicateCheck.exactDuplicate) {
                // console.log(`[GstrJsonImport] Exact duplicate detected for hash: ${fileHash}`);
                return res.json({
                    success: true,
                    data: {
                        duplicate: true,
                        previousImport: duplicateCheck.previousImport,
                        new_records: 0,
                        skipped_records: duplicateCheck.previousImport.total_record || 0
                    },
                    message: 'This file has already been imported. All records are already in the system.'
                });
            }

            // 5.5 Check for ANY existing successful import for this period (Excel or JSON)
            const periodCheck = await db('gstr_import_master')
                .where({
                    tenant_uuid: resolvedTenantId,
                    gstin_recipient: gstinRecipient,
                    return_period: returnPeriod,
                    import_type: gstrType.toUpperCase(),
                    status: 'Completed'
                })
                .select('import_filing_id', 'import_type', 'original_filename', 'upload_timestamp')
                .first();

            if (periodCheck) {
                // console.log(`[GstrJsonImport] Existing import found for period ${returnPeriod} (${periodCheck.import_type})`);
                return res.json({
                    success: true,
                    data: {
                        duplicate: true,
                        previousImport: {
                            import_filing_id: periodCheck.import_filing_id,
                            original_filename: periodCheck.original_filename,
                            uploaded_at: periodCheck.upload_timestamp,
                            import_type: periodCheck.import_type
                        },
                        new_records: 0,
                        skipped_records: 0
                    },
                    message: `Data for ${returnPeriod} has already been imported via ${periodCheck.import_type === 'JSON_IMPORT' ? 'JSON' : 'Excel'}.`
                });
            }

            // 6. Create Master Record
            const financialYear = GstrJsonImportController.calculateFinancialYear(returnPeriod);

            // 6.5 Upload JSON Data to MinIO
            const minioMetadata = {
                tenantUuid: resolvedTenantId,
                gstin: gstinRecipient,
                financialYear,
                gstrType: gstrType.toUpperCase(),
                originalFilename: `json_import_${returnPeriod}.json`,
                returnPeriod
            };

            let minioResult = { presignedUrl: null, objectPath: null };
            try {
                minioResult = await minioClient.uploadData(data, minioMetadata);
            } catch (minioErr) {
                //  console.error('[GstrJsonImport] MinIO upload failed, continuing with DB only:', minioErr.message);
            }

            // Ensure Tax Period exists (with quarterly auto-filling)
            await GstrJsonImportController.ensureTaxPeriodExists(returnPeriod, db);

            // Final safety check for undefined bindings
            const finalTenantId = resolvedTenantId || null;
            const finalUserId = userId || null;
            const finalEmail = email || null;

            //  console.log(`[GstrJsonImport] Final resolved context: tenant=${finalTenantId}, user=${finalUserId}, gstin=${gstinRecipient}`);

            const importRecord = await GSTRImportModel.createImportRecord({
                tenantUuid: finalTenantId,
                workspaceId: workspaceId,
                gstinRecipient: gstinRecipient,
                returnPeriod: returnPeriod,
                financialYear: financialYear,
                generationDate: new Date(),
                importType: gstrType.toUpperCase(),
                originalFilename: minioMetadata.originalFilename,
                uploadedFilepath: null,
                uploadedFileUrl: minioResult.presignedUrl,
                extraInfo: {
                    source: 'JSON_IMPORT',
                    minioPath: minioResult.objectPath
                },
                importedBy: finalUserId,
                userEmail: finalEmail,
                fileHash: fileHash
            });

            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Processing');

            // 5. Batch Insert into section tables
            let totalInserted = 0;
            let totalSkipped = 0;
            const allAddedInvoices = [];
            const allDuplicateInvoices = [];
            const sectionCounters = { b2b: 0, b2ba: 0, cdnr: 0, cdnra: 0, impg: 0, isd: 0, normalized: 0 };
            const normCtx = {
                returnPeriod: returnPeriod
            };
            const isGstr2a = ['GSTR2A', 'GSTR-2A'].includes(gstrType.toUpperCase());

            // Group by target table
            const tableGroups = flatRecords.reduce((acc, r) => {
                if (!acc[r.target_table]) acc[r.target_table] = [];
                acc[r.target_table].push(r);
                return acc;
            }, {});

            for (const [table, records] of Object.entries(tableGroups)) {
                // Determine the base set of columns from the first record (excluding non-db fields)
                // We add our metadata fields to the record first
                records.forEach(r => {
                    r.import_filing_id = importRecord.import_filing_id;
                    r.tenant_id = finalTenantId;
                    r.workspace_id = workspaceId;
                    if (!r.return_period) r.return_period = returnPeriod;
                });

                // Strip metadata and ensure consistent keys
                const strippedRecords = records.map(r => {
                    const { target_table, ...dbFields } = r;
                    // B2B table does not have is_amended column, but B2BA does.
                    // We strip it if it's not a B2BA/CDNRA table
                    if (!table.includes('b2ba') && !table.includes('cdnra')) {
                        delete dbFields.is_amended;
                    }
                    return dbFields;
                });

                let result;
                let keyField = 'invoice_number';

                if (table.includes('b2b_invoices')) {
                    keyField = 'invoice_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, invoice_number, return_period)', keyField);
                    sectionCounters.b2b += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2B(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_b2b_invoices' : 'gstr_2b_b2b_invoices' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('b2ba_invoices')) {
                    keyField = 'revised_invoice_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, original_invoice_number, revised_invoice_number, return_period)', keyField);
                    sectionCounters.b2ba += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2BA(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_b2ba_invoices' : 'gstr_2b_b2ba_invoices' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnr')) {
                    keyField = 'note_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, note_number, return_period)', keyField);
                    sectionCounters.cdnr += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNR(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_cdnr' : 'gstr_2b_cdnr' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnra')) {
                    keyField = 'revised_note_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, original_note_number, revised_note_number, return_period)', keyField);
                    sectionCounters.cdnra += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNRA(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_cdnra' : 'gstr_2b_cdnra' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('impg')) {
                    keyField = 'boe_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, boe_number, port_code, return_period)', keyField);
                    sectionCounters.impg += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapIMPG(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_impg' : 'gstr_2b_impg' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('isd')) {
                    keyField = 'document_number';
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, gstin_isd, document_number, return_period)', keyField);
                    sectionCounters.isd += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapISD(records, { 
                        ...normCtx, 
                        sourceTable: isGstr2a ? 'gstr_2a_isd' : 'gstr_2b_isd' 
                    });
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                }

                const inserted = result?.inserted || 0;
                const skipped = records.length - inserted;
                totalInserted += inserted;
                totalSkipped += skipped;

                if (result?.addedInvoices) {
                    allAddedInvoices.push(...result.addedInvoices);
                    const addedSet = new Set(result.addedInvoices);
                    records.forEach(r => {
                        const val = r[keyField];
                        if (val && !addedSet.has(val)) {
                            allDuplicateInvoices.push(val);
                        }
                    });
                }
            }

            // 6. Finalize
            const finalStatus = totalInserted > 0 ? 'Completed' : 'PartiallyCompleted';
            await GSTRImportModel.updateImportStatusWithCounters(
                importRecord.import_filing_id,
                sectionCounters,
                finalStatus,
                `JSON Import ${finalStatus}: ${totalInserted} inserted, ${totalSkipped} skipped.`
            );

            // Update master record with added/duplicate info in extra_info (Align with Excel)
            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, finalStatus, totalInserted, {
                source: 'JSON_IMPORT',
                added_invoices: allAddedInvoices,
                duplicate_invoices: allDuplicateInvoices
            });

            // Publish NATS event
            publishEvent('gstr-data-imported', {
                tenant_id: finalTenantId,
                workspace_id: workspaceId,
                gstin_id: gstinId,
                period: returnPeriod,
                gstr_type: gstrType,
                count: totalInserted
            });

            res.json({
                success: true,
                message: totalInserted > 0
                    ? `Import successful: ${totalInserted} records have been added.`
                    : `No new records found. ${totalSkipped} already existed.`,
                data: {
                    import_filing_id: importRecord.import_filing_id,
                    total_record: totalInserted,
                    new_records: totalInserted,
                    skipped_records: totalSkipped,
                    added_invoices: allAddedInvoices,
                    duplicate_invoices: allDuplicateInvoices,
                    section_counters: sectionCounters
                }
            });

        } catch (error) {
            //  console.error('[GstrJsonImport] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    static calculateFinancialYear(returnPeriod) {
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));
        if (month <= 3) {
            return `${year - 1}-${year.toString().substring(2)}`;
        }
        return `${year}-${(year + 1).toString().substring(2)}`;
    }

    /**
     * Ensure tax period exists in the database, creating it if necessary.
     * Replica of GSTRImportController.ensureTaxPeriodExists for microservice isolation.
     */
    static async ensureTaxPeriodExists(returnPeriod, db) {
        const periodMatch = await db.raw('SELECT id FROM tax_periods WHERE period_code = ? LIMIT 1', [returnPeriod]);
        if (periodMatch.rows.length) {
            return periodMatch.rows[0].id;
        }

        //   console.log(`[ensureTaxPeriodExists] Creating missing tax period: ${returnPeriod}`);
        const month = parseInt(returnPeriod.substring(0, 2));
        const year = parseInt(returnPeriod.substring(2));
        const fyCode = GstrJsonImportController.calculateFinancialYear(returnPeriod);

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
            //  console.error('[ensureTaxPeriodExists] Error ensuring quarterly siblings:', err.message);
        }

        return newId;
    }
}

module.exports = GstrJsonImportController;
