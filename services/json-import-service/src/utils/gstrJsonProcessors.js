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
    const results = [];
    const tablePrefix = gstrType.toUpperCase().includes('2A') ? 'gstr_2a' : 'gstr_2b';

    // 1. Process B2B
    if (rawJson.b2b) {
        for (const section of rawJson.b2b) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.inv) {
                for (const inv of section.inv) {
                    const invNum = normalizeInvoiceNumber(inv.inum);
                    const invDate = parsePortalDate(inv.idt);
                    
                    const itms = inv.itms || [];
                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_b2b_invoices`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            invoice_number_raw: inv.inum,
                            invoice_number: invNum,
                            invoice_type: inv.inv_typ || 'Regular',
                            invoice_date: invDate,
                            invoice_value: cleanAmount(inv.val),
                            place_of_supply: inv.pos,
                            reverse_charge: inv.rchrg === 'Y' ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            igst_amount: cleanAmount(det.iamt),
                            cgst_amount: cleanAmount(det.camt),
                            sgst_amount: cleanAmount(det.samt),
                            cess_amount: cleanAmount(det.csamt),
                            filing_period: inv.upd_period || null,
                            filing_date: parsePortalDate(inv.upd_dt),
                            itc_availability: inv.itc_avl === 'Y' ? 'Yes' : 'No',
                            unavailability_reason: inv.reasons || null,
                            applicable_tax_rate: det.rt?.toString() || null,
                            source: inv.srnm || null,
                            irn: inv.irn || null,
                            irn_date: parsePortalDate(inv.irngt)
                        });
                    }
                }
            }
        }
    }

    // 2. Process B2BA (Amended B2B)
    if (rawJson.b2ba) {
        for (const section of rawJson.b2ba) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.inv) {
                for (const inv of section.inv) {
                    const invNum = normalizeInvoiceNumber(inv.inum);
                    const invDate = parsePortalDate(inv.idt);
                    const oinvNum = normalizeInvoiceNumber(inv.oinum);
                    const oinvDate = parsePortalDate(inv.oidt);
                    
                    const itms = inv.itms || [];
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
                            invoice_type: inv.inv_typ || 'Regular',
                            invoice_value: cleanAmount(inv.val),
                            place_of_supply: inv.pos,
                            reverse_charge: inv.rchrg === 'Y' ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            igst_amount: cleanAmount(det.iamt),
                            cgst_amount: cleanAmount(det.camt),
                            sgst_amount: cleanAmount(det.samt),
                            cess_amount: cleanAmount(det.csamt),
                            filing_period: inv.upd_period || null,
                            filing_date: parsePortalDate(inv.upd_dt),
                            itc_availability: inv.itc_avl === 'Y' ? 'Yes' : 'No',
                            unavailability_reason: inv.reasons || null,
                            applicable_tax_rate: det.rt?.toString() || null,
                            is_amended: true
                        });
                    }
                }
            }
        }
    }

    // 3. Process CDNR
    if (rawJson.cdnr) {
        for (const section of rawJson.cdnr) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.nt) {
                for (const nt of section.nt) {
                    const noteNum = normalizeInvoiceNumber(nt.nt_num);
                    const noteDate = parsePortalDate(nt.nt_dt);
                    const oinvNum = normalizeInvoiceNumber(nt.inum);
                    const oinvDate = parsePortalDate(nt.idt);
                    
                    const itms = nt.itms || [];
                    for (const itm of itms) {
                        const det = itm.itm_det || {};
                        results.push({
                            target_table: `${tablePrefix}_cdnr`,
                            gstin_supplier: gstin,
                            trade_name: tradeName,
                            note_type: nt.ntty === 'C' ? 'Credit Note' : 'Debit Note',
                            note_number: noteNum,
                            note_date: noteDate,
                            original_invoice_number: oinvNum,
                            original_invoice_date: oinvDate,
                            note_value: cleanAmount(nt.val),
                            place_of_supply: nt.pos,
                            reverse_charge: nt.rchrg === 'Y' ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            igst_amount: cleanAmount(det.iamt),
                            cgst_amount: cleanAmount(det.camt),
                            sgst_amount: cleanAmount(det.samt),
                            cess_amount: cleanAmount(det.csamt),
                            filing_period: nt.upd_period || null,
                            filing_date: parsePortalDate(nt.upd_dt),
                            itc_availability: nt.itc_avl === 'Y' ? 'Yes' : 'No',
                            unavailability_reason: nt.reasons || null,
                            applicable_tax_rate: det.rt?.toString() || null
                        });
                    }
                }
            }
        }
    }

    // 4. Process CDNRA
    if (rawJson.cdnra) {
        for (const section of rawJson.cdnra) {
            const gstin = section.ctin;
            const tradeName = section.trdnm;
            
            if (section.nt) {
                for (const nt of section.nt) {
                    const noteNum = normalizeInvoiceNumber(nt.nt_num);
                    const noteDate = parsePortalDate(nt.nt_dt);
                    const onoteNum = normalizeInvoiceNumber(nt.ont_num);
                    const onoteDate = parsePortalDate(nt.ont_dt);
                    const oinvNum = normalizeInvoiceNumber(nt.inum);
                    const oinvDate = parsePortalDate(nt.idt);
                    
                    const itms = nt.itms || [];
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
                            note_type: nt.ntty === 'C' ? 'Credit Note' : 'Debit Note',
                            original_invoice_number: oinvNum,
                            original_invoice_date: oinvDate,
                            note_value: cleanAmount(nt.val),
                            place_of_supply: nt.pos,
                            reverse_charge: nt.rchrg === 'Y' ? 'Yes' : 'No',
                            taxable_value: cleanAmount(det.txval),
                            igst_amount: cleanAmount(det.iamt),
                            cgst_amount: cleanAmount(det.camt),
                            sgst_amount: cleanAmount(det.samt),
                            cess_amount: cleanAmount(det.csamt),
                            filing_period: nt.upd_period || null,
                            filing_date: parsePortalDate(nt.upd_dt),
                            itc_availability: nt.itc_avl === 'Y' ? 'Yes' : 'No',
                            unavailability_reason: nt.reasons || null,
                            applicable_tax_rate: det.rt?.toString() || null
                        });
                    }
                }
            }
        }
    }

    // 5. Process IMPG
    if (rawJson.impg) {
        for (const item of rawJson.impg) {
            results.push({
                target_table: `${tablePrefix}_impg`,
                port_code: item.port_cd,
                boe_number: item.boe_num,
                boe_date: parsePortalDate(item.boe_dt),
                icegate_ref_date: parsePortalDate(item.ref_dt),
                taxable_value: cleanAmount(item.txval),
                integrated_tax: cleanAmount(item.iamt),
                cess: cleanAmount(item.csamt),
                itc_availability: item.itc_avl === 'Y' ? 'Yes' : 'No',
                unavailability_reason: item.reasons || null,
                applicable_tax_rate: item.rt?.toString() || null
            });
        }
    }

    // 6. Process ISD
    if (rawJson.isd) {
        for (const section of rawJson.isd) {
            const gstinIsd = section.ctin;
            const isdName = section.trdnm;
            
            if (section.doclist) {
                for (const doc of section.doclist) {
                    results.push({
                        target_table: `${tablePrefix}_isd`,
                        gstin_isd: gstinIsd,
                        isd_name: isdName,
                        document_type: doc.doc_typ,
                        document_number: doc.doc_num,
                        document_date: parsePortalDate(doc.doc_dt),
                        integrated_tax: cleanAmount(doc.iamt),
                        central_tax: cleanAmount(doc.camt),
                        state_ut_tax: cleanAmount(doc.samt),
                        cess: cleanAmount(doc.csamt),
                        itc_availability: doc.itc_avl === 'Y' ? 'Yes' : 'No'
                    });
                }
            }
        }
    }

    return results;
};

module.exports = { processGstrJson };
