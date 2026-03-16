const { isValidGSTIN, normalizeInvoiceNumber, cleanAmount } = require('./validation');

/**
 * Common logic to resolve types (from bookSheetProcessors.js)
 */
const resolveSalesInvoiceType = (vchType, custGstin) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'CN') return 'CREDIT_NOTE';
    if (t === 'DN') return 'DEBIT_NOTE';
    if (t === 'EXPORT') return 'EXPORT';
    if (t === 'SEZ') return 'SEZ';
    return (custGstin && isValidGSTIN(custGstin)) ? 'B2B' : 'B2C_SMALL';
};

const resolveSalesBookType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'SR') return 'SR';
    if (t === 'CN') return 'CN';
    if (t === 'DN') return 'DN';
    return 'SA';
};

const resolvePurchaseVoucherType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'EXP' || t === 'EXPENSE') return 'EXPENSE';
    if (t === 'DN' || t === 'DEBIT_NOTE' || t === 'DEBIT NOTE') return 'DEBIT_NOTE';
    if (t === 'CN' || t === 'CREDIT_NOTE' || t === 'CREDIT NOTE') return 'CREDIT_NOTE';
    return 'PURCHASE'; 
};

const resolvePurchaseBookType = (vchType) => {
    const t = (vchType || '').toString().toUpperCase().trim();
    if (t === 'EXP' || t === 'EXPENSE') return 'EXP';
    if (t === 'DN' || t === 'DEBIT_NOTE' || t === 'DEBIT NOTE') return 'DN';
    if (t === 'CN' || t === 'CREDIT_NOTE' || t === 'CREDIT NOTE') return 'CN';
    return 'PA';
};

/**
 * Process Raw JSON data for Sales
 */
const processSalesJson = (data, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin) => {
    if (!Array.isArray(data)) return [];

    const invoiceMap = new Map();

    for (const row of data) {
        const invNumRaw = row.vchr_full_number || row.vchr_no || row.invoice_number || '';
        const invNum = normalizeInvoiceNumber(invNumRaw);
        if (!invNum) continue;

        const invDate = row.vchr_date || row.invoice_date || row.date;
        if (!invDate) continue;

        const groupKey = `${invNum}__${invDate}`;

        const custGstinRaw = row.party_gstn_no || row.customer_gstin || row.gstin || '';
        const custGstinClean = (custGstinRaw && isValidGSTIN(custGstinRaw)) ? custGstinRaw : null;

        const vchType = row.vchr_type || 'SA';
        const bookType = resolveSalesBookType(vchType);
        const invType = resolveSalesInvoiceType(vchType, custGstinClean);

        const taxable = cleanAmount(row.total_taxable_amount || row.taxable_value || 0);
        const igst = cleanAmount(row.total_igst_tax_amount || row.igst_amount || 0);
        const sgst = cleanAmount(row.total_sgst_tax_amount || row.sgst_amount || 0);
        const cgst = cleanAmount(row.total_cgst_tax_amount || row.cgst_amount || 0);
        const cess = cleanAmount(row.total_cess_tax_amount || row.cess_amount || 0);
        const netAmount = cleanAmount(row.net_amount || row.invoice_amount || row.total_value || 0);

        if (!invoiceMap.has(groupKey)) {
            const dateParts = invDate.split('-');
            const derivedFilingPeriod = dateParts.length === 3 ? `${dateParts[1]}${dateParts[0]}` : (returnPeriod || null);

            invoiceMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId || null,
                    invoice_type: invType,
                    book_type: bookType,
                    invoice_number: invNum,
                    invoice_date: invDate,
                    customer_name: row.party_name || row.customer_name || null,
                    customer_gstin: custGstinClean,
                    place_of_supply: row.party_state || (custGstinClean ? custGstinClean.substring(0, 2) : null),
                    is_interstate: row.inter_state === 'Yes' || row.inter_state === true,
                    reverse_charge: row.reverse_charge === 'Yes' || row.reverse_charge === true,
                    is_amendment: row.is_amendment === 'Yes' || row.is_amendment === true,
                    round_off: cleanAmount(row.round_off || 0),
                    total_taxable_value: 0,
                    total_igst: 0,
                    total_cgst: 0,
                    total_sgst: 0,
                    total_cess: 0,
                    total_invoice_value: netAmount,
                    filing_period: derivedFilingPeriod,
                    return_period: row.return_period || derivedFilingPeriod,
                },
                items: []
            });
        }

        const inv = invoiceMap.get(groupKey);
        inv.header.total_taxable_value += taxable;
        inv.header.total_igst += igst;
        inv.header.total_cgst += cgst;
        inv.header.total_sgst += sgst;
        inv.header.total_cess += cess;

        inv.items.push({
            description: row.description || null,
            taxable_value: taxable,
            gst_rate_percent: parseFloat(row.tax_per || row.gst_rate || 0),
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: cleanAmount(row.item_total || (taxable + igst + cgst + sgst + cess))
        });
    }

    return Array.from(invoiceMap.values());
};

/**
 * Process Raw JSON data for Purchase
 */
const processPurchaseJson = (data, tenantId, workspaceId, taxPeriodId, returnPeriod, orgGstin) => {
    if (!Array.isArray(data)) return [];

    const voucherMap = new Map();

    for (const row of data) {
        const bookVchrNoRaw = row.vchr_full_number || row.vchr_no || row.invoice_number || '';
        const bookVchrNo = normalizeInvoiceNumber(bookVchrNoRaw);
        const bookVchrDate = row.vchr_date || row.invoice_date || row.date;

        if (!bookVchrNo || !bookVchrDate) continue;

        const groupKey = `${bookVchrNo}__${bookVchrDate}`;

        const gstinRaw = row.party_gstn_no || row.supplier_gstin || row.gstin || '';
        const supplierGstinClean = (gstinRaw && isValidGSTIN(gstinRaw)) ? gstinRaw : null;

        const vchType = row.vchr_type || 'PA';
        const voucherType = resolvePurchaseVoucherType(vchType);
        const bookType = resolvePurchaseBookType(vchType);

        const taxable = cleanAmount(row.total_taxable_amount || row.taxable_value || 0);
        const igst = cleanAmount(row.total_igst_tax_amount || row.igst_amount || 0);
        const sgst = cleanAmount(row.total_sgst_tax_amount || row.sgst_amount || 0);
        const cgst = cleanAmount(row.total_cgst_tax_amount || row.cgst_amount || 0);
        const cess = cleanAmount(row.total_cess_tax_amount || row.cess_amount || 0);
        const netAmount = cleanAmount(row.net_amount || row.invoice_amount || row.total_value || 0);

        if (!voucherMap.has(groupKey)) {
            const dateParts = bookVchrDate.split('-');
            const derivedFilingPeriod = dateParts.length === 3 ? `${dateParts[1]}${dateParts[0]}` : (returnPeriod || null);

            voucherMap.set(groupKey, {
                header: {
                    tenant_id: tenantId,
                    workspace_id: workspaceId,
                    tax_period_id: taxPeriodId || null,
                    voucher_type: voucherType,
                    book_type: bookType,
                    book_vchr_no: bookVchrNo,
                    book_vchr_date: bookVchrDate,
                    supplier_invoice_no: row.ref_vchr_full_number || bookVchrNo,
                    supplier_invoice_date: row.ref_vchr_date || bookVchrDate,
                    supplier_name: row.party_name || row.supplier_name || null,
                    supplier_gstin: supplierGstinClean,
                    place_of_supply: row.party_state || (supplierGstinClean ? supplierGstinClean.substring(0, 2) : null),
                    is_interstate: row.inter_state === 'Yes' || row.inter_state === true ? 'Yes' : 'No',
                    is_rcm: row.reverse_charge === 'Yes' || row.reverse_charge === true,
                    round_off: cleanAmount(row.round_off || 0),
                    status: 'DRAFT',
                    taxable_total: 0,
                    total_igst_amount: 0,
                    total_cgst_amount: 0,
                    total_sgst_amount: 0,
                    total_cess_amount: 0,
                    net_amount: netAmount,
                    filing_period: derivedFilingPeriod,
                    return_period: row.return_period || derivedFilingPeriod,
                    is_amendment: row.is_amendment === 'Yes' || row.is_amendment === true
                },
                items: []
            });
        }

        const v = voucherMap.get(groupKey);
        v.header.taxable_total += taxable;
        v.header.total_igst_amount += igst;
        v.header.total_cgst_amount += cgst;
        v.header.total_sgst_amount += sgst;
        v.header.total_cess_amount += cess;

        v.items.push({
            description: row.description || null,
            taxable_amount: taxable,
            tax_per: parseFloat(row.tax_per || 0),
            igst_amount: igst,
            cgst_amount: cgst,
            sgst_amount: sgst,
            cess_amount: cess,
            total_amount_with_tax: cleanAmount(row.item_total || (taxable + igst + cgst + sgst + cess))
        });
    }

    return Array.from(voucherMap.values());
};

module.exports = { processSalesJson, processPurchaseJson };
