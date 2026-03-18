const { isValidGSTIN, normalizeInvoiceNumber, cleanAmount } = require('./validation');

/**
 * GSTR JSON Processors
 * Handles official GST portal JSON structure for GSTR-2A/2B
 */

/**
 * Helper to parse portal date string (DD-MM-YYYY)
 */
const parsePortalDate = (dt) => {
    if (!dt) return null;
    const parts = dt.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
    }
    return dt;
};

/**
 * Flatten GSTR-2B / 2A JSON into table-ready records
 */
const processGstrJson = (rawJson, gstrType = 'GSTR2B') => {
    let results = [];
    const tablePrefix = gstrType.toUpperCase().includes('2A') ? 'gstr_2a' : 'gstr_2b';

    // 0. Unwrap nested structure if present (handle data.docdata or docdata)
    let processedJson = rawJson;
    if (processedJson.data) processedJson = processedJson.data;
    if (processedJson.docdata) processedJson = processedJson.docdata;

    // 1. Process B2B
    if (processedJson.b2b) {
        for (const section of processedJson.b2b) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.inv) {
                for (const inv of section.inv) {
                    const invNum = normalizeInvoiceNumber(inv.inum);
                    const invDate = parsePortalDate(inv.idt || inv.dt); // Fallback to 'dt'
                    
                    // Fallback for flattened items (no 'itms' array)
                    const itms = inv.itms || [
                        {
                            itm_det: {
                                txval: inv.txval,
                                iamt: inv.igst,
                                camt: inv.cgst,
                                samt: inv.sgst,
                                csamt: inv.cess,
                                rt: inv.rt || (inv.taxable_value > 0 ? Math.round(((cleanAmount(inv.igst) || 0) + (cleanAmount(inv.cgst) || 0) + (cleanAmount(inv.sgst) || 0)) / cleanAmount(inv.txval) * 100) : null)
                            }
                        }
                    ];

                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_b2b_invoices`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            invoice_number_raw: inv.inum,
                            invoice_number: invNum,
                            invoice_type: inv.inv_typ || inv.typ || 'Regular', // Fallback to 'typ'
                            invoice_date: invDate,
                            invoice_value: cleanAmount(inv.val),
                            place_of_supply: inv.pos,
                            reverse_charge: (inv.rchrg === 'Y' || inv.rev === 'Y') ? 'Yes' : 'No', // Fallback to 'rev'
                            taxable_value: cleanAmount(det.txval),
                            integrated_tax: cleanAmount(det.iamt),
                            central_tax: cleanAmount(det.camt),
                            state_ut_tax: cleanAmount(det.samt),
                            cess: cleanAmount(det.csamt),
                            supplier_filing_period: inv.upd_period || section.supprd || null,
                            supplier_filing_date: parsePortalDate(inv.upd_dt || section.supfildt),
                            itc_availability: (inv.itc_avl === 'Y' || inv.itcavl === 'Y') ? 'Yes' : 'No', // Fallback to 'itcavl'
                            itc_availability_reason: inv.reasons || inv.rsn || null, // Fallback to 'rsn'
                            applicable_tax_rate: det.rt?.toString() || null,
                            source: inv.srnm || inv.srctyp || null,
                            irn: inv.irn || null,
                            irn_date: parsePortalDate(inv.irngt || inv.irngendate),
                            is_amended: false
                        });
                    }
                }
            }
        }
    }

    // 2. Process B2BA (Amended B2B)
    if (processedJson.b2ba) {
        for (const section of processedJson.b2ba) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.inv) {
                for (const inv of section.inv) {
                    const invNum = normalizeInvoiceNumber(inv.inum);
                    const invDate = parsePortalDate(inv.idt || inv.dt);
                    const oinvNum = normalizeInvoiceNumber(inv.oinum);
                    const oinvDate = parsePortalDate(inv.oidt);
                    
                    const itms = inv.itms || [
                        {
                            itm_det: {
                                txval: inv.txval,
                                iamt: inv.igst,
                                camt: inv.cgst,
                                samt: inv.sgst,
                                csamt: inv.cess,
                                rt: inv.rt
                            }
                        }
                    ];

                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_b2ba_invoices`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            original_invoice_number: oinvNum,
                            original_invoice_date: oinvDate,
                            revised_invoice_number: invNum,
                            revised_invoice_date: invDate,
                            invoice_type: inv.inv_typ || inv.typ || 'Regular',
                            invoice_value: cleanAmount(inv.val),
                            place_of_supply: inv.pos,
                            reverse_charge: (inv.rchrg === 'Y' || inv.rev === 'Y') ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            integrated_tax: cleanAmount(det.iamt),
                            central_tax: cleanAmount(det.camt),
                            state_ut_tax: cleanAmount(det.samt),
                            cess: cleanAmount(det.csamt),
                            supplier_filing_period: inv.upd_period || section.supprd || null,
                            supplier_filing_date: parsePortalDate(inv.upd_dt || section.supfildt),
                            itc_availability: (inv.itc_avl === 'Y' || inv.itcavl === 'Y') ? 'Yes' : 'No',
                            itc_availability_reason: inv.reasons || inv.rsn || null,
                            applicable_tax_rate: det.rt?.toString() || null,
                            is_amended: true
                        });
                    }
                }
            }
        }
    }

    // 3. Process CDNR
    if (processedJson.cdnr) {
        for (const section of processedJson.cdnr) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.nt) {
                for (const nt of section.nt) {
                    const noteNum = normalizeInvoiceNumber(nt.nt_num || nt.ntnum);
                    const noteDate = parsePortalDate(nt.nt_dt || nt.dt);
                    const oinvNum = normalizeInvoiceNumber(nt.inum);
                    const oinvDate = parsePortalDate(nt.idt);
                    
                    const itms = nt.itms || [
                        {
                            itm_det: {
                                txval: nt.txval,
                                iamt: nt.igst,
                                camt: nt.cgst,
                                samt: nt.sgst,
                                csamt: nt.cess,
                                rt: nt.rt
                            }
                        }
                    ];

                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_cdnr`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            note_type: (nt.ntty === 'C' || nt.typ === 'C') ? 'Credit Note' : 'Debit Note',
                            note_number: noteNum,
                            note_date: noteDate,
                            original_invoice_number: oinvNum,
                            original_invoice_date: oinvDate,
                            note_value: cleanAmount(nt.val),
                            place_of_supply: nt.pos,
                            reverse_charge: (nt.rchrg === 'Y' || nt.rev === 'Y') ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            integrated_tax: cleanAmount(det.iamt),
                            central_tax: cleanAmount(det.camt),
                            state_ut_tax: cleanAmount(det.samt),
                            cess: cleanAmount(det.csamt),
                            supplier_filing_period: nt.upd_period || section.supprd || null,
                            supplier_filing_date: parsePortalDate(nt.upd_dt || section.supfildt),
                            itc_availability: (nt.itc_avl === 'Y' || nt.itcavl === 'Y') ? 'Yes' : 'No',
                            itc_availability_reason: nt.reasons || nt.rsn || null,
                            applicable_tax_rate: det.rt?.toString() || null
                        });
                    }
                }
            }
        }
    }

    // 4. Process CDNRA
    if (processedJson.cdnra) {
        for (const section of processedJson.cdnra) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.nt) {
                for (const nt of section.nt) {
                    const noteNum = normalizeInvoiceNumber(nt.nt_num || nt.ntnum);
                    const noteDate = parsePortalDate(nt.nt_dt || nt.dt);
                    const onoteNum = normalizeInvoiceNumber(nt.ont_num);
                    const onoteDate = parsePortalDate(nt.ont_dt);
                    const oinvNum = normalizeInvoiceNumber(nt.inum);
                    const oinvDate = parsePortalDate(nt.idt);
                    
                    const itms = nt.itms || [
                        {
                            itm_det: {
                                txval: nt.txval,
                                iamt: nt.igst,
                                camt: nt.cgst,
                                samt: nt.sgst,
                                csamt: nt.csamt,
                                rt: nt.rt
                            }
                        }
                    ];

                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_cdnra`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            original_note_number: onoteNum,
                            original_note_date: onoteDate,
                            revised_note_number: noteNum,
                            revised_note_date: noteDate,
                            note_type: (nt.ntty === 'C' || nt.typ === 'C') ? 'Credit Note' : 'Debit Note',
                            original_invoice_number: oinvNum,
                            original_invoice_date: oinvDate,
                            note_value: cleanAmount(nt.val),
                            place_of_supply: nt.pos,
                            reverse_charge: (nt.rchrg === 'Y' || nt.rev === 'Y') ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            integrated_tax: cleanAmount(det.iamt),
                            central_tax: cleanAmount(det.camt),
                            state_ut_tax: cleanAmount(det.samt),
                            cess: cleanAmount(det.csamt),
                            supplier_filing_period: nt.upd_period || section.supprd || null,
                            supplier_filing_date: parsePortalDate(nt.upd_dt || section.supfildt),
                            itc_availability: (nt.itc_avl === 'Y' || nt.itcavl === 'Y') ? 'Yes' : 'No',
                            itc_availability_reason: nt.reasons || nt.rsn || null,
                            applicable_tax_rate: det.rt?.toString() || null
                        });
                    }
                }
            }
        }
    }

    // 5. Process IMPG
    if (processedJson.impg) {
        for (const item of processedJson.impg) {
            results.push({
                target_table: `${tablePrefix}_impg`,
                port_code: item.port_cd || item.port_code,
                boe_number: item.boe_num || item.boe_number,
                boe_date: parsePortalDate(item.boe_dt || item.boe_date),
                icegate_ref_date: parsePortalDate(item.ref_dt || item.icegate_ref_date),
                taxable_value: cleanAmount(item.txval),
                integrated_tax: cleanAmount(item.iamt || item.igst),
                cess: cleanAmount(item.csamt || item.cess),
                itc_availability: (item.itc_avl === 'Y' || item.itcavl === 'Y') ? 'Yes' : 'No',
                itc_availability_reason: item.reasons || item.rsn || null,
                applicable_tax_rate: item.rt?.toString() || null
            });
        }
    }

    // 6. Process ISD
    if (processedJson.isd) {
        for (const section of processedJson.isd) {
            const gstinIsd = section.ctin;
            const isdName = section.trdnm;
            
            if (section.doclist) {
                for (const doc of section.doclist) {
                    results.push({
                        target_table: `${tablePrefix}_isd`,
                        gstin_isd: gstinIsd,
                        isd_name: isdName,
                        document_type: doc.doc_typ || doc.typ,
                        document_number: doc.doc_num || doc.inum,
                        document_date: parsePortalDate(doc.doc_dt || doc.dt),
                        integrated_tax: cleanAmount(doc.iamt || doc.igst),
                        central_tax: cleanAmount(doc.camt || doc.cgst),
                        state_ut_tax: cleanAmount(doc.samt || doc.sgst),
                        cess: cleanAmount(doc.csamt || doc.cess),
                        itc_availability: (doc.itc_avl === 'Y' || doc.itcavl === 'Y') ? 'Yes' : 'No'
                    });
                }
            }
        }
    }

    return results;
};

module.exports = { processGstrJson };

module.exports = { processGstrJson };
