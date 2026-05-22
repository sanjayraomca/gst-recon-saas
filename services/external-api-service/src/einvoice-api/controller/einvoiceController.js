const model = require('../model/einvoiceModel');
const crypto = require('crypto');
const gstModel = require('../../gst-api/model/gstModel');

/**
 * POST /ext/einvoice/irn - Generate E-Invoice / IRN (Simulated Sandbox)
 */
const generateIrn = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { gstin, doc_number, doc_type, doc_date, buyer_gstin, buyer_name, taxable_value, total_invoice_value } = req.body;

        if (!gstin || !doc_number || !doc_type || !doc_date || !buyer_gstin || !taxable_value || !total_invoice_value) {
            return res.status(400).json({ success: false, error: 'Missing required parameters. gstin, doc_number, doc_type, doc_date, buyer_gstin, taxable_value, and total_invoice_value are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await gstModel.ensureGstinInMaster(gstin);

        // Generate a unique IRN (64-character hex string)
        const irnSource = `${gstin}-${doc_type}-${doc_number}`;
        const irn = crypto.createHash('sha256').update(irnSource).digest('hex');

        // Check if already exists in cache
        const cached = await model.getCachedIrn(clientId, irn);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, source: 'cache', data: cached });
        }

        // Calculate CGST/SGST/IGST mocks
        const igst = Number((taxable_value * 0.18).toFixed(2));
        const cgst = Number((taxable_value * 0.09).toFixed(2));
        const sgst = Number((taxable_value * 0.09).toFixed(2));

        // Generate simulated response
        const ackNo = Math.floor(100000000000 + Math.random() * 900000000000);
        const docDateObj = new Date(doc_date);
        const retPeriod = `${String(docDateObj.getMonth() + 1).padStart(2, '0')}${docDateObj.getFullYear()}`;

        const mockResponse = {
            ack_number: ackNo,
            ack_date: new Date().toISOString(),
            doc_number,
            doc_type,
            doc_date,
            ret_period: retPeriod,
            supply_type: 'B2B',
            rstin_flag: 'Y',
            buyer_gstin,
            buyer_name: buyer_name || 'Mock Buyer Ltd',
            taxable_value: Number(taxable_value),
            igst_amount: buyer_gstin.substring(0, 2) !== gstin.substring(0, 2) ? igst : 0,
            cgst_amount: buyer_gstin.substring(0, 2) === gstin.substring(0, 2) ? cgst : 0,
            sgst_amount: buyer_gstin.substring(0, 2) === gstin.substring(0, 2) ? sgst : 0,
            cess_amount: 0,
            total_invoice_value: Number(total_invoice_value),
            signed_invoice: `MOCK_SIGNED_INVOICE_JWT_FOR_IRN_${irn}`,
            signed_qr_code: `MOCK_SIGNED_QR_CODE_DATA_FOR_IRN_${irn}`,
            status: 'ACTIVE',
        };

        // Save to cache registry
        await model.upsertIrn(clientId, gstin, irn, mockResponse);

        res.set('X-Cache', 'MISS');
        return res.json({
            success: true,
            source: 'live',
            irn,
            data: mockResponse
        });
    } catch (error) {
        console.error('[generateIrn]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /ext/einvoice/irn/:irn - Fetch E-Invoice details by IRN
 */
const getIrnDetails = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { irn } = req.params;

        if (!irn || irn.length !== 64) {
            return res.status(400).json({ success: false, error: 'Invalid or missing IRN. Must be a 64-character hash.' });
        }

        const cached = await model.getCachedIrn(clientId, irn);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, data: cached });
        }

        return res.status(404).json({ success: false, error: 'E-Invoice IRN not found.' });
    } catch (error) {
        console.error('[getIrnDetails]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /ext/einvoice/irn/cancel - Cancel E-Invoice
 */
const cancelIrn = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { irn, cancel_reason } = req.body;

        if (!irn || !cancel_reason) {
            return res.status(400).json({ success: false, error: 'irn and cancel_reason are required.' });
        }

        const cached = await model.getCachedIrn(clientId, irn);
        if (!cached) {
            return res.status(404).json({ success: false, error: 'E-Invoice IRN not found.' });
        }

        if (cached.status === 'CANCELLED') {
            return res.status(400).json({ success: false, error: 'E-Invoice is already cancelled.' });
        }

        // Update in cache registry
        const updatedData = {
            ...cached.raw_response,
            status: 'CANCELLED',
            cancel_date: new Date().toISOString(),
            cancel_reason: cancel_reason || 'Wrong details entered'
        };

        await model.upsertIrn(clientId, cached.gstin, irn, updatedData);

        return res.json({
            success: true,
            message: 'E-Invoice cancelled successfully.',
            irn,
            cancel_date: updatedData.cancel_date
        });
    } catch (error) {
        console.error('[cancelIrn]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /ext/einvoice/hsnsum - Get HSN summary of E-Invoices
 */
const getHsnSummary = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { gstin, ret_period } = req.query;

        if (!gstin || !ret_period) {
            return res.status(400).json({ success: false, error: 'gstin and ret_period (MMYYYY) are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await gstModel.ensureGstinInMaster(gstin);

        // Check cache first
        const cached = await model.getCachedHsnSummary(clientId, gstin, ret_period);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, source: 'cache', data: cached.hsn_data });
        }

        // Generate simulated HSN summary
        const mockHsnSummary = [
            { hsn: '84713010', desc: 'Laptop Computers', qty: 10, unit: 'NOS', val: 500000, tax_val: 500000, igst: 90000, cgst: 0, sgst: 0 },
            { hsn: '85171200', desc: 'Mobile Phones', qty: 25, unit: 'NOS', val: 250000, tax_val: 250000, igst: 0, cgst: 22500, sgst: 22500 }
        ];

        await model.upsertHsnSummary(clientId, gstin, ret_period, mockHsnSummary);

        res.set('X-Cache', 'MISS');
        return res.json({ success: true, source: 'live', data: mockHsnSummary });
    } catch (error) {
        console.error('[getHsnSummary]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    generateIrn,
    getIrnDetails,
    cancelIrn,
    getHsnSummary
};
