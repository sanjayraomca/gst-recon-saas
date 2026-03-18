const GSTRImportModel = require('../models/gstrImportModel');
const NormalizedGstr2bModel = require('../models/normalizedGstr2bModel');
const { processGstrJson } = require('../utils/gstrJsonProcessors');
const { publishEvent } = require('../nats/natsClient');
const crypto = require('crypto');
const db = require('../../../shared/src/db/connection');

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
            
            // 1. Fetch GSTIN and Workspace info
            let gstinRecipient = null;
            let workspaceId = gstinId;

            console.log(`[GstrJsonImport] Resolving context for workspaceId/gstinId: ${workspaceId}`);

            const gstinQuery = await db.raw(
                'SELECT gm.gstin, w.tenant_id, w.id as workspace_id FROM gstin_master gm JOIN workspaces w ON w.gstin_id = gm.id WHERE w.id = ? OR gm.id = ?',
                [workspaceId, workspaceId]
            );

            console.log(`[GstrJsonImport] gstinQuery rows count: ${gstinQuery.rows?.length || 0}`);

            let resolvedTenantId = userTenantId;

            if (gstinQuery.rows && gstinQuery.rows.length > 0) {
                // Use the first match
                const match = gstinQuery.rows.find(r => r.workspace_id === workspaceId) || gstinQuery.rows[0];
                gstinRecipient = match.gstin;
                workspaceId = match.workspace_id; // Ensure we use the workspace UUID
                
                console.log(`[GstrJsonImport] Found match: GSTIN=${gstinRecipient}, Workspace=${workspaceId}, Tenant=${match.tenant_id}`);

                // If tenant_id missing in token, use the one from workspace
                if (!resolvedTenantId) {
                    resolvedTenantId = match.tenant_id;
                }
            } else {
                 console.error(`[GstrJsonImport] No match found for ID: ${workspaceId}. Body:`, req.body);
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

            // 5. Create Master Record
            const financialYear = GstrJsonImportController.calculateFinancialYear(returnPeriod);
            
            // Final safety check for undefined bindings
            const finalTenantId = resolvedTenantId || null;
            const finalUserId = userId || null;
            const finalEmail = email || null;

            console.log(`[GstrJsonImport] Final resolved context: tenant=${finalTenantId}, user=${finalUserId}, gstin=${gstinRecipient}`);

            const importRecord = await GSTRImportModel.createImportRecord({
                tenantUuid: finalTenantId,
                workspaceId: workspaceId,
                gstinRecipient: gstinRecipient,
                returnPeriod: returnPeriod,
                financialYear: financialYear,
                generationDate: new Date(),
                importType: gstrType.toUpperCase(),
                originalFilename: `json_import_${Date.now()}.json`,
                uploadedFilepath: 'json_direct_import',
                uploadedFileUrl: '',
                extraInfo: { source: 'JSON_IMPORT' },
                importedBy: finalUserId,
                userEmail: finalEmail,
                fileHash: fileHash
            });

            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Processing');

            // 5. Batch Insert into section tables
            let totalInserted = 0;
            const sectionCounters = { b2b: 0, b2ba: 0, cdnr: 0, cdnra: 0, impg: 0, isd: 0, normalized: 0 };
            const normCtx = {
                tenantId: finalTenantId,
                workspaceId,
                importFilingId: importRecord.import_filing_id,
                returnPeriod: returnPeriod
            };

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
                if (table.includes('b2b_invoices')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, invoice_number, return_period)', 'invoice_number');
                    sectionCounters.b2b += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2B(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('b2ba_invoices')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, original_invoice_number, revised_invoice_number, return_period)', 'revised_invoice_number');
                    sectionCounters.b2ba += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2BA(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnr')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, note_number, return_period)', 'note_number');
                    sectionCounters.cdnr += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNR(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnra')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, original_note_number, revised_note_number, return_period)', 'revised_note_number');
                    sectionCounters.cdnra += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNRA(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('impg')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, boe_number, port_code, return_period)', 'boe_number');
                    sectionCounters.impg += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapIMPG(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('isd')) {
                    result = await GSTRImportModel.batchInsertToTable(table, strippedRecords, '(tenant_id, gstin_isd, document_number, return_period)', 'document_number');
                    sectionCounters.isd += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapISD(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                }
                
                totalInserted += result?.inserted || 0;
            }

            // 6. Finalize
            await GSTRImportModel.updateImportStatusWithCounters(
                importRecord.import_filing_id,
                sectionCounters,
                'Completed',
                `JSON Import Successful: ${totalInserted} records added.`
            );

            // 7. Publish NATS Event
            publishEvent('gstr-data-imported', {
                tenant_id: finalTenantId,
                workspace_id: workspaceId,
                import_type: gstrType.toUpperCase(),
                count: totalInserted
            });

            res.json({
                success: true,
                message: `Import successful: ${totalInserted} records have been added.`,
                data: {
                    import_filing_id: importRecord.import_filing_id,
                    total_inserted: totalInserted,
                    section_counters: sectionCounters
                }
            });

        } catch (error) {
            console.error('[GstrJsonImport] Error:', error);
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
}

module.exports = GstrJsonImportController;
