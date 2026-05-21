const db = require('../../config/db');

const getCachedEwaybill = async (clientId, ewaybillNumber) => {
    return await db('ext_ewaybill')
        .where({ client_id: clientId, ewaybill_number: ewaybillNumber })
        .first();
};

const upsertEwaybill = async (clientId, gstin, ewaybillNumber, data) => {
    const row = {
        client_id: clientId,
        gstin,
        ewaybill_number: ewaybillNumber,
        ewaybill_date: data.ewaybill_date || data.ewbDate || null,
        valid_until: data.valid_until || data.validUpto || null,
        doc_number: data.doc_number || data.docNo || null,
        doc_type: data.doc_type || data.docType || null,
        doc_date: data.doc_date || data.docDate || null,
        supply_type: data.supply_type || null,
        consignor_gstin: data.consignor_gstin || data.fromGstin || null,
        consignor_name: data.consignor_name || null,
        consignee_gstin: data.consignee_gstin || data.toGstin || null,
        consignee_name: data.consignee_name || null,
        from_state: data.from_state || null,
        to_state: data.to_state || null,
        taxable_value: data.taxable_value || null,
        total_value: data.total_value || null,
        igst_value: data.igst_value || null,
        cgst_value: data.cgst_value || null,
        sgst_value: data.sgst_value || null,
        cess_value: data.cess_value || null,
        transporter_gstin: data.transporter_gstin || null,
        transporter_name: data.transporter_name || null,
        trans_mode: data.trans_mode || null,
        trans_distance: data.trans_distance || null,
        vehicle_number: data.vehicle_number || data.vehNo || null,
        vehicle_type: data.vehicle_type || null,
        status: data.status || 'ACTIVE',
        cancel_date: data.cancel_date || null,
        cancel_reason: data.cancel_reason || null,
        raw_response: JSON.stringify(data),
        updated_at: new Date()
    };

    await db('ext_ewaybill')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['client_id', 'ewaybill_number'])
        .merge({ ...row });
};

const insertVehicleLog = async (ewaybillId, ewaybillNumber, data) => {
    await db('ext_ewaybill_vehicle_log').insert({
        ewaybill_id: ewaybillId,
        ewaybill_number: ewaybillNumber,
        vehicle_number: data.vehicle_number || data.vehNo,
        vehicle_type: data.vehicle_type || null,
        from_place: data.from_place || null,
        from_state: data.from_state || null,
        update_reason: data.update_reason || null,
        updated_at: new Date()
    });
};

module.exports = {
    getCachedEwaybill,
    upsertEwaybill,
    insertVehicleLog
};
