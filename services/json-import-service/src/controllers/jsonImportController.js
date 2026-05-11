const db = require('../../../shared/src/db/connection');
const BookModel = require('../models/bookModel');
const { processSalesJson, processPurchaseJson } = require('../utils/jsonProcessors');
const { publishEvent } = require('../nats/natsClient');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

/**
 * Controller for JSON Data Import
 */
class JsonImportController {
    /**
     * POST /json-import/book/sales/upload
     * Expects: { data: Array, gstinId: String, returnPeriod: String, orgGstin: String }
     */
    static async uploadSalesBook(req, res) {
        try {
            const { data, gstinId, returnPeriod, orgGstin } = req.body;
            const tenant_id = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];

            if (!data || !Array.isArray(data)) {
                return res.status(400).json({ success: false, error: 'Invalid data format. Expected an array of objects.' });
            }

            // Process data into internal format
            const processedInvoices = processSalesJson(data, tenant_id, gstinId, null, returnPeriod, orgGstin);

            if (processedInvoices.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // Perform bulk insert
            const result = await BookModel.bulkInsertSales(processedInvoices);

            // Resolve GSTIN ID from Workspace
            const workspaceRec = await db('workspaces').where('id', gstinId).select('gstin_id').first();
            const resolvedGstinId = workspaceRec ? workspaceRec.gstin_id : null;

            // Publish NATS event
            publishEvent('book-data-imported', {
                tenant_id,
                workspace_id: gstinId,
                gstin_id: resolvedGstinId,
                period: returnPeriod,
                type: 'SALES',
                count: result.inserted
            });

            res.json({
                success: true,
                message: `Import successful: ${result.inserted} records added.`,
                data: result
            });

            // Log successful import
            await logActivity({
                userId: req.user?.db_id || req.user?.id || req.user?.sub,
                tenantId: tenant_id,
                workspaceId: gstinId,
                actionType: 'IMPORT_SALES_BOOK',
                entityType: 'BOOK_DATA',
                details: { 
                    page_name: 'Sales Register',
                    records: result.inserted, 
                    period: returnPeriod, 
                    orgGstin, 
                    source: 'JSON' 
                },
                req
            });

        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /json-import/book/purchase/upload
     * Expects: { data: Array, gstinId: String, returnPeriod: String, orgGstin: String }
     */
    static async uploadPurchaseBook(req, res) {
        try {
            const { data, gstinId, returnPeriod, orgGstin } = req.body;
            const tenant_id = req.user?.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];

            if (!data || !Array.isArray(data)) {
                return res.status(400).json({ success: false, error: 'Invalid data format. Expected an array of objects.' });
            }

            // Process data into internal format
            const processedVouchers = processPurchaseJson(data, tenant_id, gstinId, null, returnPeriod, orgGstin);

            if (processedVouchers.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // Perform bulk insert
            const result = await BookModel.bulkInsertPurchase(processedVouchers);

            // Resolve GSTIN ID from Workspace
            const workspaceRecPurchase = await db('workspaces').where('id', gstinId).select('gstin_id').first();
            const resolvedGstinIdPurchase = workspaceRecPurchase ? workspaceRecPurchase.gstin_id : null;

            // Publish NATS event
            publishEvent('book-data-imported', {
                tenant_id,
                workspace_id: gstinId,
                gstin_id: resolvedGstinIdPurchase,
                period: returnPeriod,
                type: 'PURCHASE',
                count: result.inserted
            });

            res.json({
                success: true,
                message: `Import successful: ${result.inserted} records added.`,
                data: result
            });

            // Log successful import
            await logActivity({
                userId: req.user?.db_id || req.user?.id || req.user?.sub,
                tenantId: tenant_id,
                workspaceId: gstinId,
                actionType: 'IMPORT_PURCHASE_BOOK',
                entityType: 'BOOK_DATA',
                details: { 
                    page_name: 'Purchase Register',
                    records: result.inserted, 
                    period: returnPeriod, 
                    orgGstin, 
                    source: 'JSON' 
                },
                req
            });

        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = JsonImportController;
