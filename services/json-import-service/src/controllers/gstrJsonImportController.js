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
            const { tenant_id, email, id: userId } = req.user;

            if (!data || typeof data !== 'object') {
                return res.status(400).json({ success: false, error: 'Invalid data format. Expected a JSON object.' });
            }

            if (!gstinId || !returnPeriod || !gstrType) {
                return res.status(400).json({ success: false, error: 'Missing required fields: gstinId, returnPeriod, gstrType' });
            }

            console.log(`[GstrJsonImport] Processing ${gstrType} for tenant ${tenant_id}, workspace ${gstinId}`);

            // 1. Fetch GSTIN and Workspace info
            let gstinRecipient = null;
            let workspaceId = gstinId;

            const gstinQuery = await db.raw(
                'SELECT gm.gstin FROM gstin_master gm WHERE gm.id = ?',
                [workspaceId]
            );
            if (gstinQuery.rows && gstinQuery.rows.length > 0) {
                gstinRecipient = gstinQuery.rows[0].gstin;
            } else {
                 return res.status(400).json({ success: false, error: 'Invalid GSTIN ID' });
            }

            // 2. Process data into internal format
            const flatRecords = processGstrJson(data, gstrType);

            if (flatRecords.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // 3. Compute Hash for duplicate detection (of the stringified data)
            const fileHash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');

            // 4. Create Master Record
            const financialYear = GstrJsonImportController.calculateFinancialYear(returnPeriod);
            
            const importRecord = await GSTRImportModel.createImportRecord({
                tenantUuid: tenant_id,
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
                importedBy: userId,
                userEmail: email,
                fileHash: fileHash
            });

            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Processing');

            // 5. Batch Insert into section tables
            let totalInserted = 0;
            const sectionCounters = { b2b: 0, b2ba: 0, cdnr: 0, cdnra: 0, impg: 0, isd: 0, normalized: 0 };
            const normCtx = {
                tenantId: tenant_id,
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
                // Add import_filing_id, tenant_id, workspace_id, return_period to each record
                records.forEach(r => {
                    r.import_filing_id = importRecord.import_filing_id;
                    r.tenant_id = tenant_id;
                    r.workspace_id = workspaceId;
                    if (!r.return_period) r.return_period = returnPeriod;
                });

                let result;
                if (table.includes('b2b_invoices')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, invoice_number, return_period)', 'invoice_number');
                    sectionCounters.b2b += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2B(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('b2ba_invoices')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, original_invoice_number, revised_invoice_number, return_period)', 'revised_invoice_number');
                    sectionCounters.b2ba += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapB2BA(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnr')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, note_number, return_period)', 'note_number');
                    sectionCounters.cdnr += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNR(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('cdnra')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, original_note_number, revised_note_number, return_period)', 'revised_note_number');
                    sectionCounters.cdnra += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapCDNRA(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('impg')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, boe_number, port_code, return_period)', 'boe_number');
                    sectionCounters.impg += result.inserted;
                    const normRows = NormalizedGstr2bModel.mapIMPG(records, normCtx);
                    const normResult = await NormalizedGstr2bModel.batchInsert(normRows);
                    sectionCounters.normalized += normResult.inserted;
                } else if (table.includes('isd')) {
                    result = await GSTRImportModel.batchInsertToTable(table, records, '(tenant_id, gstin_isd, document_number, return_period)', 'document_number');
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
                tenant_id,
                workspace_id,
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
