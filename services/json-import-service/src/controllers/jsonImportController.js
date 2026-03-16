const BookModel = require('../models/bookModel');
const { processSalesJson, processPurchaseJson } = require('../utils/jsonProcessors');
const { publishEvent } = require('../nats/natsClient');

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
            const { tenant_id } = req.user;

            if (!data || !Array.isArray(data)) {
                return res.status(400).json({ success: false, error: 'Invalid data format. Expected an array of objects.' });
            }

            console.log(`[JsonImport] Processing ${data.length} sales records for tenant ${tenant_id}`);

            // Process data into internal format
            const processedInvoices = processSalesJson(data, tenant_id, gstinId, null, returnPeriod, orgGstin);

            if (processedInvoices.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // Perform bulk insert
            const result = await BookModel.bulkInsertSales(processedInvoices);

            // Publish NATS event
            publishEvent('book-data-imported', {
                tenant_id,
                workspace_id: gstinId,
                type: 'SALES',
                count: result.inserted
            });

            res.json({
                success: true,
                message: `Import successful: ${result.inserted} records added.`,
                data: result
            });

        } catch (error) {
            console.error('[JsonImport] Sales Error:', error);
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
            const { tenant_id } = req.user;

            if (!data || !Array.isArray(data)) {
                return res.status(400).json({ success: false, error: 'Invalid data format. Expected an array of objects.' });
            }

            console.log(`[JsonImport] Processing ${data.length} purchase records for tenant ${tenant_id}`);

            // Process data into internal format
            const processedVouchers = processPurchaseJson(data, tenant_id, gstinId, null, returnPeriod, orgGstin);

            if (processedVouchers.length === 0) {
                return res.status(400).json({ success: false, error: 'No valid records found in the provided JSON data.' });
            }

            // Perform bulk insert
            const result = await BookModel.bulkInsertPurchase(processedVouchers);

            // Publish NATS event
            publishEvent('book-data-imported', {
                tenant_id,
                workspace_id: gstinId,
                type: 'PURCHASE',
                count: result.inserted
            });

            res.json({
                success: true,
                message: `Import successful: ${result.inserted} records added.`,
                data: result
            });

        } catch (error) {
            console.error('[JsonImport] Purchase Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = JsonImportController;
