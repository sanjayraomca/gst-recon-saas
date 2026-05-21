const db = require('../../config/db');

const getCachedIrn = async (clientId, irn) => {
    return await db('ext_einvoice_irn')
        .where({ client_id: clientId, irn })
        .first();
};

const upsertIrn = async (clientId, gstin, irn, data) => {
    const row = {
        client_id: clientId,
        gstin,
        irn,
        ack_number: data.ack_number || data.ackNo || null,
        ack_date: data.ack_date || data.ackDt || null,
        doc_number: data.doc_number || data.docNo || null,
        doc_type: data.doc_type || data.docTyp || null,
        doc_date: data.doc_date || data.docDt || null,
        ret_period: data.ret_period || null,
        supply_type: data.supply_type || null,
        rstin_flag: data.rstin_flag || null,
        buyer_gstin: data.buyer_gstin || null,
        buyer_name: data.buyer_name || null,
        taxable_value: data.taxable_value || null,
        igst_amount: data.igst_amount || null,
        cgst_amount: data.cgst_amount || null,
        sgst_amount: data.sgst_amount || null,
        cess_amount: data.cess_amount || null,
        total_invoice_value: data.total_invoice_value || null,
        signed_invoice: data.signed_invoice || null,
        signed_qr_code: data.signed_qr_code || null,
        status: data.status || 'ACTIVE',
        cancel_date: data.cancel_date || null,
        cancel_reason: data.cancel_reason || null,
        raw_response: JSON.stringify(data),
        updated_at: new Date()
    };

    await db('ext_einvoice_irn')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['client_id', 'irn'])
        .merge({ ...row });
};

const getCachedHsnSummary = async (clientId, gstin, retPeriod) => {
    return await db('ext_einvoice_hsn_summary')
        .where({ client_id: clientId, gstin, ret_period: retPeriod })
        .where('cached_until', '>', new Date())
        .first();
};

const upsertHsnSummary = async (clientId, gstin, retPeriod, data) => {
    const cachedUntil = new Date();
    cachedUntil.setHours(cachedUntil.getHours() + 24); // Cache HSN summary for 24 hours

    const row = {
        client_id: clientId,
        gstin,
        ret_period: retPeriod,
        hsn_data: JSON.stringify(data),
        cached_until: cachedUntil,
        updated_at: new Date()
    };

    await db('ext_einvoice_hsn_summary')
        .insert({ ...row, created_at: new Date() })
        .onConflict(['client_id', 'gstin', 'ret_period'])
        .merge({ ...row });
};

module.exports = {
    getCachedIrn,
    upsertIrn,
    getCachedHsnSummary,
    upsertHsnSummary
};
