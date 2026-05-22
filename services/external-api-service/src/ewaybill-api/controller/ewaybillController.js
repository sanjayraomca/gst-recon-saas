const model = require('../model/ewaybillModel');
const gstModel = require('../../gst-api/model/gstModel');

/**
 * POST /ext/ewaybill - Generate E-Way Bill (Simulated Sandbox)
 */
const generateEwb = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { gstin, doc_number, doc_type, doc_date, consignee_gstin, consignee_name, total_value, transporter_gstin, trans_mode, trans_distance, vehicle_number } = req.body;

        if (!gstin || !doc_number || !doc_type || !doc_date || !consignee_gstin || !total_value || !trans_mode || !trans_distance) {
            return res.status(400).json({ success: false, error: 'Missing required parameters. gstin, doc_number, doc_type, doc_date, consignee_gstin, total_value, trans_mode, and trans_distance are required.' });
        }

        // Ensure this GSTIN details are present in gstin_master
        await gstModel.ensureGstinInMaster(gstin);

        // Generate mock 12-digit E-Way Bill Number
        const ewbNo = String(Math.floor(100000000000 + Math.random() * 900000000000));

        const mockResponse = {
            ewaybill_number: ewbNo,
            ewaybill_date: new Date().toISOString(),
            valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000 * Math.ceil(trans_distance / 100)).toISOString(), // 1 day per 100km
            doc_number,
            doc_type,
            doc_date,
            supply_type: 'O', // Outward
            consignor_gstin: gstin,
            consignor_name: 'Mock Consignor Corp',
            consignee_gstin,
            consignee_name: consignee_name || 'Mock Consignee Corp',
            from_state: gstin.substring(0, 2),
            to_state: consignee_gstin.substring(0, 2),
            taxable_value: Number(total_value * 0.85).toFixed(2),
            total_value: Number(total_value),
            igst_value: consignee_gstin.substring(0, 2) !== gstin.substring(0, 2) ? Number(total_value * 0.18).toFixed(2) : 0,
            cgst_value: consignee_gstin.substring(0, 2) === gstin.substring(0, 2) ? Number(total_value * 0.09).toFixed(2) : 0,
            sgst_value: consignee_gstin.substring(0, 2) === gstin.substring(0, 2) ? Number(total_value * 0.09).toFixed(2) : 0,
            cess_value: 0,
            transporter_gstin: transporter_gstin || null,
            transporter_name: transporter_gstin ? 'Mock Transport Ltd' : null,
            trans_mode,
            trans_distance: Number(trans_distance),
            vehicle_number: vehicle_number || null,
            vehicle_type: vehicle_number ? 'R' : null, // Regular
            status: 'ACTIVE'
        };

        // Cache the newly created E-Way Bill details
        await model.upsertEwaybill(clientId, gstin, ewbNo, mockResponse);

        // If vehicle number is provided, log it to vehicle updates log
        if (vehicle_number) {
            const cachedRecord = await model.getCachedEwaybill(clientId, ewbNo);
            await model.insertVehicleLog(cachedRecord.id, ewbNo, {
                vehicle_number,
                vehicle_type: 'R',
                from_place: 'Origin Warehouse',
                from_state: gstin.substring(0, 2),
                update_reason: 1 // First vehicle assignment
            });
        }

        res.set('X-Cache', 'MISS');
        return res.json({
            success: true,
            source: 'live',
            ewaybill_number: ewbNo,
            data: mockResponse
        });
    } catch (error) {
        console.error('[generateEwb]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /ext/ewaybill/:ewbNo - Get E-Way Bill details
 */
const getEwbDetails = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { ewbNo } = req.params;

        if (!ewbNo || ewbNo.length !== 12) {
            return res.status(400).json({ success: false, error: 'Invalid or missing E-Way Bill Number. Must be a 12-digit number.' });
        }

        const cached = await model.getCachedEwaybill(clientId, ewbNo);
        if (cached) {
            req.cacheHit = true;
            res.set('X-Cache', 'HIT');
            return res.json({ success: true, data: cached });
        }

        return res.status(404).json({ success: false, error: 'E-Way Bill not found.' });
    } catch (error) {
        console.error('[getEwbDetails]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /ext/ewaybill/cancel - Cancel E-Way Bill
 */
const cancelEwb = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { ewaybill_number, cancel_reason } = req.body;

        if (!ewaybill_number || !cancel_reason) {
            return res.status(400).json({ success: false, error: 'ewaybill_number and cancel_reason are required.' });
        }

        const cached = await model.getCachedEwaybill(clientId, ewaybill_number);
        if (!cached) {
            return res.status(404).json({ success: false, error: 'E-Way Bill not found.' });
        }

        if (cached.status === 'CANCELLED') {
            return res.status(400).json({ success: false, error: 'E-Way Bill is already cancelled.' });
        }

        const updatedData = {
            ...cached.raw_response,
            status: 'CANCELLED',
            cancel_date: new Date().toISOString(),
            cancel_reason: String(cancel_reason)
        };

        await model.upsertEwaybill(clientId, cached.gstin, ewaybill_number, updatedData);

        return res.json({
            success: true,
            message: 'E-Way Bill cancelled successfully.',
            ewaybill_number,
            cancel_date: updatedData.cancel_date
        });
    } catch (error) {
        console.error('[cancelEwb]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /ext/ewaybill/vehicle - Update vehicle details (Part B)
 */
const updateVehicle = async (req, res) => {
    try {
        const clientId = req.apiClient.id;
        const { ewaybill_number, vehicle_number, vehicle_type, from_place, from_state, update_reason } = req.body;

        if (!ewaybill_number || !vehicle_number || !from_place || !from_state || !update_reason) {
            return res.status(400).json({ success: false, error: 'ewaybill_number, vehicle_number, from_place, from_state, and update_reason are required.' });
        }

        const cached = await model.getCachedEwaybill(clientId, ewaybill_number);
        if (!cached) {
            return res.status(404).json({ success: false, error: 'E-Way Bill not found.' });
        }

        if (cached.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, error: `Cannot update vehicle for an E-Way Bill with status: ${cached.status}.` });
        }

        // Update active vehicle in raw response
        const updatedData = {
            ...cached.raw_response,
            vehicle_number,
            vehicle_type: vehicle_type || 'R'
        };

        await model.upsertEwaybill(clientId, cached.gstin, ewaybill_number, updatedData);

        // Log vehicle change log
        await model.insertVehicleLog(cached.id, ewaybill_number, {
            vehicle_number,
            vehicle_type: vehicle_type || 'R',
            from_place,
            from_state,
            update_reason
        });

        return res.json({
            success: true,
            message: 'E-Way Bill vehicle details (Part B) updated successfully.',
            ewaybill_number,
            updated_vehicle: vehicle_number
        });
    } catch (error) {
        console.error('[updateVehicle]', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    generateEwb,
    getEwbDetails,
    cancelEwb,
    updateVehicle
};
