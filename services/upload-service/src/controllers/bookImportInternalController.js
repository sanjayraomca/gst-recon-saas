const GSTRImportModel = require('../models/gstrImportModel');
const BookModel = require('../models/bookModel');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');
const { processPurchaseSheet, processSalesSheet } = require('../utils/bookSheetProcessors');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { publishEvent } = require('../nats/natsClient');
const xlsx = require('xlsx');
const fs = require('fs');
const db = require('../../../shared/src/db/connection');

/**
 * BookImportInternalController
 *
 * Internal-only route handler for the ERP API key connector.
 * Called by workspace-service AFTER it has validated the API key.
 *
 * Uses the EXACT same BookModel + GSTRImportModel + bookSheetProcessors
 * as the normal manual upload — zero logic duplication.
 *
 * Route: POST /book-import/internal/upload
 *
 * Required headers (set by workspace-service connector, not by ERP):
 *   x-internal-service: connector
 *   x-tenant-id:        <tenantId from API key>
 *   x-workspace-id:     <workspaceId from API key>
 *   x-connector-mode:   live | demo
 *   x-connector-key-type: production | sandbox
 *
 * Required body (multipart/form-data):
 *   file          — the .csv or .xlsx file
 *   type          — PURCHASE | SALES | PURCHASE_RETURN | SALES_RETURN
 *   return_period — MMYYYY
 */
const uploadInternal = async (req, res) => {
    let uploadedFilePath = null;
    try {
        if (!req.file) {
            return errorResponse(res, 'No file received', 400);
        }
        uploadedFilePath = req.file.path;

        // ── Context injected by workspace-service connector (not from JWT) ──
        const tenantUuid   = req.headers['x-tenant-id'];
        const workspaceId  = req.headers['x-workspace-id'];
        const mode         = req.headers['x-connector-mode']   || 'live';
        const keyType      = req.headers['x-connector-key-type'] || 'production';

        if (!tenantUuid || !workspaceId) {
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            return errorResponse(res, 'Missing x-tenant-id or x-workspace-id header', 400);
        }

        const { type, return_period } = req.body;

        if (!return_period) {
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            return errorResponse(res, 'return_period is required (MMYYYY)', 400);
        }

        const validTypes = ['PURCHASE', 'SALES', 'PURCHASE_RETURN', 'SALES_RETURN'];
        const uploadType = (type || '').toUpperCase();
        if (!validTypes.includes(uploadType)) {
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            return errorResponse(res, `type must be one of: ${validTypes.join(', ')}`, 400);
        }

        // ── Resolve workspace GSTIN (same logic as main controller) ──────────
        const wgq = await db.raw(
            'SELECT gm.gstin FROM workspaces w JOIN gstin_master gm ON w.gstin_id = gm.id WHERE w.id = ?',
            [workspaceId]
        );
        const expectedGstin = wgq.rows.length ? wgq.rows[0].gstin : null;

        // ── Parse file — same as main controller ─────────────────────────────
        const workbook = xlsx.readFile(uploadedFilePath);
        const sheetName = workbook.SheetNames[0];
        const jsonRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

        if (!jsonRows || jsonRows.length < 2) {
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            return errorResponse(res, 'File has no data rows', 400);
        }

        console.log(`[ConnectorInternal] type=${uploadType} workspace=${workspaceId} rows=${jsonRows.length - 1}`);

        // ── Create import record ──────────────────────────────────────────────
        const financialYear = TaxPeriodService.calculateFinancialYear(return_period);
        const IMPORT_TYPE   = uploadType.includes('SALES') ? 'SALES_REGISTER' : 'PURCHASE_REGISTER';

        const importRecord = await GSTRImportModel.createImportRecord({
            tenantUuid,
            workspaceId,
            gstinRecipient: 'SELF',
            returnPeriod:   return_period,
            financialYear,
            generationDate: new Date(),
            importType:     IMPORT_TYPE,
            originalFilename: req.file.originalname || 'connector_upload',
            uploadedFilepath: null,
            uploadedFileUrl:  null,
            extraInfo: {
                source:   'api_connector_file',
                mode,
                key_type: keyType
            },
            importedBy: null,
            userEmail:  'connector@api',
            fileHash:   null
        });

        // ── Process — EXACT same processors as manual upload ─────────────────
        let result;
        if (uploadType === 'SALES' || uploadType === 'SALES_RETURN') {
            const invoices = processSalesSheet(jsonRows, tenantUuid, workspaceId, null, null, expectedGstin, uploadType);
            await BookImportInternalController.assignDynamicPeriods(invoices, db);
            result = await BookModel.bulkInsertSales(invoices);
        } else {
            const vouchers = processPurchaseSheet(jsonRows, tenantUuid, workspaceId, null, null, expectedGstin, uploadType);
            await BookImportInternalController.assignDynamicPeriods(vouchers, db);
            result = await BookModel.bulkInsertPurchase(vouchers);
        }

        // ── Handle empty result ───────────────────────────────────────────────
        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'No valid records found in file'
            });
            if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
            return errorResponse(res, 'No valid records found in the uploaded file', 400);
        }

        // ── Update import status ──────────────────────────────────────────────
        await GSTRImportModel.updateImportStatus(importRecord.import_filing_id, 'Completed', result.inserted, {
            source:             'api_connector_file',
            mode,
            key_type:           keyType,
            added_invoices:     result.addedInvoices.slice(0, 50),
            duplicate_invoices: result.duplicateInvoices.slice(0, 50)
        });

        // ── Publish NATS event for reconciliation trigger ─────────────────────
        publishEvent('book-data-imported', {
            tenant_id:    tenantUuid,
            workspace_id: workspaceId,
            period:       return_period,
            type:         uploadType,
            count:        result.inserted,
            source:       'api_connector'
        });

        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);

        await logActivity({
            userId:      null,
            tenantId:    tenantUuid,
            workspaceId,
            actionType:  `CONNECTOR_${uploadType}_IMPORT`,
            entityType:  'BookData',
            details: {
                filename:         req.file.originalname,
                records_inserted: result.inserted,
                records_updated:  result.duplicateInvoices.length,
                period:           return_period,
                mode,
                key_type:         keyType
            },
            req
        });

        return successResponse(res, {
            import_id:        importRecord.import_filing_id,
            filename:         req.file.originalname,
            type:             uploadType,
            return_period,
            mode,
            records_inserted: result.inserted,
            records_updated:  result.duplicateInvoices.length,
            added_refs:       result.addedInvoices.slice(0, 20),
            updated_refs:     result.duplicateInvoices.slice(0, 20)
        }, `Import successful: ${result.inserted} inserted, ${result.duplicateInvoices.length} updated`);

    } catch (err) {
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
        console.error('[BookImportInternalController.uploadInternal]', err);
        return errorResponse(res, err.message, 500);
    }
};

/**
 * assignDynamicPeriods — reused from main BookImportController
 * Ensures each document has a resolved tax_period_id via TaxPeriodService.
 */
const assignDynamicPeriods = async (documents, dbConn) => {
    for (const doc of documents) {
        if (doc.header && doc.header.filing_period) {
            const pid = await TaxPeriodService.ensureTaxPeriodExists(doc.header.filing_period, dbConn);
            if (pid) doc.header.tax_period_id = pid;
        }
    }
};

const BookImportInternalController = { uploadInternal, assignDynamicPeriods };
module.exports = BookImportInternalController;
