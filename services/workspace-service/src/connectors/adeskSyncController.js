const knex = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const { publishMessage } = require('../../../shared/src/nats/client');
const TaxPeriodService = require('../../../shared/src/services/taxPeriodService');
const ConnectorImportModel = require('./connectorImportModel');
const { isValidGSTIN } = require('./validation');
const axios = require('axios');

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Helper: Calculate dynamic start and end dates based on FY string, quarter, and month.
 * Handles fiscal boundaries and Leap years dynamically.
 */
const calculateDates = (year, quarter, month) => {
    const parts = year.split('-');
    const year1 = parseInt(parts[0]);
    const year2 = parts[1] ? (parts[1].trim().length === 4 ? parseInt(parts[1].trim()) : (year1 - (year1 % 100) + parseInt(parts[1].trim()))) : (year1 + 1);

    let start_date, end_date;

    if (month && month !== 'all') {
        const m = parseInt(month);
        const y = (m >= 1 && m <= 3) ? year2 : year1;
        const monthStr = String(m).padStart(2, '0');
        start_date = `${y}-${monthStr}-01`;

        const lastDay = new Date(y, m, 0).getDate();
        const lastDayStr = String(lastDay).padStart(2, '0');
        end_date = `${y}-${monthStr}-${lastDayStr}`;
    } else {
        if (quarter === 'Q1') {
            start_date = `${year1}-04-01`;
            end_date = `${year1}-06-30`;
        } else if (quarter === 'Q2') {
            start_date = `${year1}-07-01`;
            end_date = `${year1}-09-30`;
        } else if (quarter === 'Q3') {
            start_date = `${year1}-10-01`;
            end_date = `${year1}-12-31`;
        } else if (quarter === 'Q4') {
            start_date = `${year2}-01-01`;
            end_date = `${year2}-03-31`;
        }
    }

    return { start_date, end_date };
};

/**
 * Helper: Derive the return period (MMYYYY format) dynamically from a date string (YYYY-MM-DD).
 */
const getPeriodFromDate = (dateStr) => {
    if (!dateStr) return '042026';
    const parts = dateStr.split('-');
    if (parts.length < 2) return '042026';
    return `${parts[1]}${parts[0]}`;
};

/**
 * Map individual purchase records from Adesk Accounting schema to our standard connector format.
 * Incorporates robust data validation checks same as book data import.
 */
const mapPurchaseRecord = (record, tenantId, workspaceId, defaultReturnPeriod) => {
    const vchrDate = record.supplier_invoice_date || record.vchr_date || null;
    const returnPeriod = vchrDate ? getPeriodFromDate(vchrDate) : defaultReturnPeriod;

    // Support both custom mock keys and real Adesk response keys
    const supplierInvoiceNo = String(record.supplier_invoice_no || record.vchr_full_number || record.vchr_no || '').trim();
    const bookVchrNo = String(record.book_vchr_no || record.vchr_full_number || record.vchr_no || '').trim();
    const supplierGstin = String(record.supplier_gstin || record.party_gstn_no || '').trim().toUpperCase();
    const supplierName = String(record.supplier_name || record.party_name || 'Generic Supplier').trim();

    let bookType = (record.book_type || record.vchr_prefix || 'PA').trim().toUpperCase();
    let voucherType = (record.voucher_type || record.vchr_type || 'PURCHASE').trim().toUpperCase();

    // Translate abbreviations to satisfy PostgreSQL database Check Constraints
    if (voucherType === 'EXP' || voucherType === 'EXPENSE') {
        voucherType = 'EXPENSE';
    } else if (voucherType === 'PUR' || voucherType === 'PURCHASE' || voucherType === 'PA') {
        voucherType = 'PURCHASE';
    } else if (voucherType === 'DN' || voucherType === 'DEBIT_NOTE') {
        voucherType = 'DEBIT_NOTE';
    } else if (voucherType === 'CN' || voucherType === 'CREDIT_NOTE') {
        voucherType = 'CREDIT_NOTE';
    } else {
        voucherType = 'PURCHASE';
    }

    // Map bookType to valid column values: 'PA' (purchase), 'EXP' (expense), 'CN' (credit note), 'DN' (debit note)
    if (voucherType === 'EXPENSE') {
        bookType = 'EXP';
    } else if (voucherType === 'PURCHASE') {
        bookType = 'PA';
    } else if (voucherType === 'DEBIT_NOTE') {
        bookType = 'DN';
    } else if (voucherType === 'CREDIT_NOTE') {
        bookType = 'CN';
    } else {
        // Fallback mapping based on substring checking if voucherType is unknown
        if (bookType.includes('EXP')) {
            bookType = 'EXP';
        } else if (bookType.includes('DN')) {
            bookType = 'DN';
        } else if (bookType.includes('CN')) {
            bookType = 'CN';
        } else {
            bookType = 'PA';
        }
    }

    // Validation checks matching book data import
    if (!supplierInvoiceNo) {
        throw new Error('Validation Error: Missing supplier invoice / voucher number');
    }

    // Enforce GSTIN validation only for registered purchase books (not expenses), or if a GSTIN is supplied
    const isExpense = (bookType === 'EXP' || voucherType === 'EXPENSE');
    if (!isExpense && !supplierGstin) {
        throw new Error('Validation Error: Missing supplier GSTIN');
    }
    if (supplierGstin && !isValidGSTIN(supplierGstin)) {
        throw new Error(`Validation Error: Invalid Supplier GSTIN format "${supplierGstin}"`);
    }

    // Derive financials using both custom mock schema and real Adesk schema keys
    const taxableTotal = parseFloat(record.taxable_value || record.taxable_amount || record.total_taxable_amount || 0);
    const netAmount = parseFloat(record.net_amount || record.total_value || record.invoice_amount || record.row_wise_total_amount || 0);
    const totalIgstAmount = parseFloat(record.igst || record.igst_amount || record.total_igst_tax_amount || 0);
    const totalCgstAmount = parseFloat(record.cgst || record.cgst_amount || record.total_cgst_tax_amount || 0);
    const totalSgstAmount = parseFloat(record.sgst || record.sgst_amount || record.total_sgst_tax_amount || 0);
    const totalCessAmount = parseFloat(record.cess || record.cess_amount || record.total_cess_tax_amount || 0);

    const header = {
        tenant_id: tenantId,
        workspace_id: workspaceId,

        // Invoice identity
        supplier_invoice_no: supplierInvoiceNo,
        supplier_invoice_date: vchrDate,
        book_vchr_no: bookVchrNo,
        book_vchr_date: record.book_vchr_date || vchrDate,

        // Supplier
        supplier_name: supplierName,
        supplier_gstin: supplierGstin,

        // Financials
        taxable_total: taxableTotal,
        net_amount: netAmount,
        total_igst_amount: totalIgstAmount,
        total_cgst_amount: totalCgstAmount,
        total_sgst_amount: totalSgstAmount,
        total_cess_amount: totalCessAmount,
        round_off: parseFloat(record.round_off || record.round_off_amount || 0),
        discount: parseFloat(record.discount || 0),
        total_qty: parseFloat(record.total_qty || 0),

        // GST Fields
        place_of_supply: record.place_of_supply || null,
        is_interstate: record.is_interstate || (record.inter_state === 'Yes') || false,
        is_rcm: record.is_rcm || (record.reverse_charge === 'Yes') || false,
        voucher_type: voucherType,
        book_type: bookType,
        gstr_category: record.gstr_category || 'NONGST',
        status: record.status || 'DRAFT',
        remarks: record.remarks || null,

        // Period
        filing_period: returnPeriod,
        return_period: returnPeriod,
        tax_period_id: null,

        t_extra_info: { source: 'adesk_cloud_connector', connector_ref: record.connector_ref || null }
    };

    // If item array is not provided (standard in raw Adesk API), construct a single virtual item line
    let items = [];
    if (record.items && record.items.length > 0) {
        items = record.items.map(item => ({
            hsn_code: String(item.hsn_code || '').trim() || null,
            description: item.description || null,
            quantity: parseFloat(item.quantity || 0),
            uom: item.uom || null,
            unit_rate: parseFloat(item.unit_rate || 0),
            taxable_amount: parseFloat(item.taxable_amount || 0),
            tax_per: parseFloat(item.tax_per || 0),
            igst_amount: parseFloat(item.igst_amount || 0),
            cgst_amount: parseFloat(item.cgst_amount || 0),
            sgst_amount: parseFloat(item.sgst_amount || 0),
            cess_amount: parseFloat(item.cess_amount || 0),
            total_amount_with_tax: parseFloat(item.total_amount_with_tax || 0),
            t_extra_info: {}
        }));
    } else {
        items = [{
            hsn_code: null,
            description: record.description || 'Voucher details',
            quantity: 1,
            uom: 'NOS',
            unit_rate: taxableTotal,
            taxable_amount: taxableTotal,
            tax_per: parseFloat(record.tax_per || 0),
            igst_amount: totalIgstAmount,
            cgst_amount: totalCgstAmount,
            sgst_amount: totalSgstAmount,
            cess_amount: totalCessAmount,
            total_amount_with_tax: netAmount,
            t_extra_info: {}
        }];
    }

    return { header, items };
};

/**
 * Map individual sales records from Adesk Accounting schema to our standard connector format.
 * Incorporates robust data validation checks same as book data import.
 */
const mapSalesRecord = (record, tenantId, workspaceId, defaultReturnPeriod) => {
    const vchrDate = record.supplier_invoice_date || record.vchr_date || null;
    const returnPeriod = vchrDate ? getPeriodFromDate(vchrDate) : defaultReturnPeriod;

    const invoiceNumber = String(record.supplier_invoice_no || record.vchr_full_number || record.vchr_no || '').trim();
    const customerGstin = String(record.party_gstn_no || '').trim().toUpperCase();
    const customerName = String(record.party_name || 'Generic Customer').trim();

    let bookType = (record.book_type || record.vchr_prefix || 'SA').trim().toUpperCase();
    let invoiceType = (record.voucher_type || record.vchr_type || 'B2B').trim().toUpperCase();

    // Translate abbreviations to satisfy PostgreSQL database Check Constraints
    if (invoiceType === 'DN' || invoiceType === 'DEBIT_NOTE') {
        invoiceType = 'DEBIT_NOTE';
    } else if (invoiceType === 'CN' || invoiceType === 'CREDIT_NOTE') {
        invoiceType = 'CREDIT_NOTE';
    } else {
        invoiceType = 'B2B'; // Must be one of B2B, B2C_SMALL, B2C_LARGE, EXPORT, SEZ
    }

    // Map bookType to valid column values: 'SA' (sales), 'SR' (sales return), 'CN' (credit note), 'DN' (debit note)
    if (invoiceType === 'DEBIT_NOTE') {
        bookType = 'DN';
    } else if (invoiceType === 'CREDIT_NOTE') {
        bookType = 'CN';
    } else {
        bookType = 'SA';
    }

    // Validation checks matching book data import
    if (!invoiceNumber) {
        throw new Error('Validation Error: Missing invoice / voucher number');
    }

    if (customerGstin && !isValidGSTIN(customerGstin)) {
        throw new Error(`Validation Error: Invalid Customer GSTIN format "${customerGstin}"`);
    }

    // Derive financials using both custom mock schema and real Adesk schema keys
    const taxableTotal = parseFloat(record.taxable_value || record.taxable_amount || record.total_taxable_amount || 0);
    const netAmount = parseFloat(record.net_amount || record.total_value || record.invoice_amount || record.row_wise_total_amount || 0);
    const totalIgstAmount = parseFloat(record.igst || record.igst_amount || record.total_igst_tax_amount || 0);
    const totalCgstAmount = parseFloat(record.cgst || record.cgst_amount || record.total_cgst_tax_amount || 0);
    const totalSgstAmount = parseFloat(record.sgst || record.sgst_amount || record.total_sgst_tax_amount || 0);
    const totalCessAmount = parseFloat(record.cess || record.cess_amount || record.total_cess_tax_amount || 0);

    const header = {
        tenant_id: tenantId,
        workspace_id: workspaceId,

        // Invoice identity
        invoice_number: invoiceNumber,
        invoice_date: vchrDate,

        // Customer
        customer_name: customerName,
        customer_gstin: customerGstin || null,

        // Financials
        total_taxable_value: taxableTotal,
        total_invoice_value: netAmount,
        total_igst: totalIgstAmount,
        total_cgst: totalCgstAmount,
        total_sgst: totalSgstAmount,
        total_cess: totalCessAmount,
        round_off: parseFloat(record.round_off || record.round_off_amount || 0),
        discount: parseFloat(record.discount || 0),

        // GST Fields
        place_of_supply: record.place_of_supply || null,
        reverse_charge: record.reverse_charge === 'Yes' || record.reverse_charge === true,
        is_amendment: record.is_amendment === 'Yes' || record.is_amendment === true,
        book_type: bookType,
        invoice_type: invoiceType,
        gstr_category: record.gstr_category || 'B2B',
        status: record.status || 'DRAFT',
        remarks: record.remarks || null,

        // Period
        filing_period: returnPeriod,
        return_period: returnPeriod,
        tax_period_id: null,

        t_extra_info: { source: 'adesk_cloud_connector', connector_ref: record.connector_ref || null }
    };

    // Construct item lines
    let items = [];
    if (record.items && record.items.length > 0) {
        items = record.items.map(item => ({
            hsn_sac_code: String(item.hsn_code || item.hsn_sac_code || '').trim() || null,
            description: item.description || null,
            quantity: parseFloat(item.quantity || 0),
            uom: item.uom || null,
            unit_rate: parseFloat(item.unit_rate || 0),
            taxable_value: parseFloat(item.taxable_amount || item.taxable_value || 0),
            gst_rate_percent: parseFloat(item.tax_per || item.gst_rate_percent || 0),
            igst_amount: parseFloat(item.igst_amount || 0),
            cgst_amount: parseFloat(item.cgst_amount || 0),
            sgst_amount: parseFloat(item.sgst_amount || 0),
            cess_amount: parseFloat(item.cess_amount || 0),
            total_amount_with_tax: parseFloat(item.total_amount_with_tax || 0),
            t_extra_info: {}
        }));
    } else {
        items = [{
            hsn_sac_code: null,
            description: record.description || 'Voucher details',
            quantity: 1,
            uom: 'NOS',
            unit_rate: taxableTotal,
            taxable_value: taxableTotal,
            gst_rate_percent: parseFloat(record.tax_per || 0),
            igst_amount: totalIgstAmount,
            cgst_amount: totalCgstAmount,
            sgst_amount: totalSgstAmount,
            cess_amount: totalCessAmount,
            total_amount_with_tax: netAmount,
            t_extra_info: {}
        }];
    }

    return { header, items };
};

/**
 * POST /connectors/adesk/pull-purchase
 * Trigger manual pull request to the Adesk Cloud API Server.
 */
/**
 * Helper: Log pull sync actions (both success and fail) in activity_logs
 */
const logPullActivity = async (req, workspace, status, actionType, details) => {
    try {
        await logActivity({
            userId: req.user ? (req.user.db_id || req.user.id || req.user.sub) : null,
            tenantId: workspace ? workspace.tenant_id : null,
            workspaceId: workspace ? workspace.id : (req.body ? req.body.workspace_id : null),
            actionType: actionType,
            entityType: 'ConnectorSync',
            details: {
                status,
                year: req.body ? req.body.year : null,
                quarter: req.body ? req.body.quarter : null,
                month: req.body ? req.body.month : null,
                ...details
            },
            req
        });
    } catch (e) {
        console.error('[logPullActivity] Failed to log pull activity:', e.message);
    }
};

/**
 * POST /connectors/adesk/pull-purchase
 * Trigger manual pull request to the Adesk Cloud API Server.
 */
const pullPurchaseData = async (req, res) => {
    let workspace = null;
    const { workspace_id, year, quarter, month, start_date: reqStartDate, end_date: reqEndDate, book_type } = req.body;
    try {
        if (!workspace_id) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_PULL_INVALID_INPUT', { error: 'workspace_id is required' });
            return errorResponse(res, 'workspace_id is required', 400);
        }
        if (!year || !quarter || !month) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_PULL_INVALID_INPUT', { error: 'year, quarter, and month are required' });
            return errorResponse(res, 'year, quarter, and month are required', 400);
        }

        // Fetch workspace details
        workspace = await knex('workspaces')
            .where({ id: workspace_id })
            .select('id', 'tenant_id', 'gstn', 'name', 'settings')
            .first();

        if (!workspace) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_PULL_WORKSPACE_NOT_FOUND', { error: 'Workspace not found' });
            return errorResponse(res, 'Workspace not found', 404);
        }

        const settings = typeof workspace.settings === 'string'
            ? JSON.parse(workspace.settings)
            : (workspace.settings || {});

        const adeskConfig = settings.adeskCloudConnector || {};
        const cloudUrl = adeskConfig.cloudUrl;
        const apiToken = adeskConfig.apiToken;

        if (!apiToken) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_AUTH_MISSING', { error: 'Adesk API Key is missing' });
            return errorResponse(res, 'Adesk API Key is missing. Configure it in Connector Setup first.', 400);
        }
        if (!cloudUrl) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_AUTH_MISSING', { error: 'Adesk Cloud URL is missing' });
            return errorResponse(res, 'Adesk Cloud URL is missing. Configure it in Connector Setup first.', 400);
        }

        // Calculate dynamic period dates (use explicit dates if provided, otherwise calculate)
        let start_date = reqStartDate;
        let end_date = reqEndDate;
        if (!start_date || !end_date) {
            const dates = calculateDates(year, quarter, month);
            start_date = dates.start_date;
            end_date = dates.end_date;
        }

        const resolvedBookType = book_type || 'all';

        const requestBody = {
            fyear: year,
            start_date: start_date,
            end_date: end_date,
            book_type: resolvedBookType,
            gstn_number: workspace.gstn,
            rows: 99999
        };

        const requestHeaders = {
            'X-TIG-API-KEY': apiToken ? `${apiToken.substring(0, 8)}...` : undefined,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'tenant-id': workspace.tenant_id,
            'workspace-id': String(workspace.id),
            'user-id': req.user ? (req.user.db_id || req.user.id || req.user.sub) : '',
            'user-name': req.user ? (req.user.name || 'User') : '',
            'user-email': req.user ? (req.user.email || 'user@example.com') : ''
        };

        const isMockServer = cloudUrl.includes('mock-adesk');
        const targetCloudUrl = isMockServer ? 'http://localhost:3002/connectors/mock-adesk' : cloudUrl;

        // ── Fetch all records (paginated GET for real API, single POST for mock) ──
        let allRecords = [];

        if (isMockServer) {
            // Legacy mock server: POST with JSON body
            const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
            const encodedKey = Buffer.from(rawKey).toString('base64');
            let response;
            try {
                response = await axios.post(targetCloudUrl, {
                    type: 'purchase', start_date, end_date,
                    year: year || '2025-2026', book_type: resolvedBookType
                }, {
                    headers: {
                        'api_key': encodedKey, 'x-api-key': encodedKey,
                        'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json',
                        'tenant-id': workspace.tenant_id, 'workspace-id': String(workspace.id),
                        'x-adesk-sync-source': 'saas-orchestrator'
                    }, timeout: 10000
                });
            } catch (apiErr) {
                await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_CONNECTION_ERROR', { error: apiErr.message, cloudUrl });
                return errorResponse(res, `Failed to reach mock server: ${apiErr.message}`, 502);
            }
            const mockRes = response.data;
            if (!mockRes || mockRes.success !== 1 || !Array.isArray(mockRes.data)) {
                await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_INVALID_RESPONSE', { error: mockRes?.message || 'Invalid response' });
                return errorResponse(res, mockRes?.message || 'Invalid response from mock server', 502);
            }
            allRecords = mockRes.data;
        } else {
            // Real Adesk API: POST with body parameters + X-TIG-API-KEY + base64 x-api-key
            const cleanUrl = cloudUrl.split('?')[0];
            const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
            const encodedKey = Buffer.from(rawKey).toString('base64');
            let response;
            try {
                response = await axios.post(cleanUrl, {
                    type: resolvedBookType === 'sales' ? 'sales' : 'purchase',
                    fyear: year || '2025-2026',
                    start_date: start_date,
                    end_date: end_date,
                    book_type: resolvedBookType,
                    gstn_number: workspace.gstn,
                    rows: 99999
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'x-api-key': encodedKey,
                        'api_key': encodedKey,
                        'X-TIG-API-KEY': apiToken,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'tenant-id': workspace.tenant_id,
                        'workspace-id': String(workspace.id),
                        'user-id': req.user ? (req.user.db_id || req.user.id || req.user.sub) : '',
                        'user-name': req.user ? (req.user.name || 'User') : '',
                        'user-email': req.user ? (req.user.email || 'user@example.com') : ''
                    },
                    timeout: 45000
                });
            } catch (apiErr) {
                await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_CONNECTION_ERROR', {
                    error: apiErr.message,
                    responseError: apiErr.response?.data,
                    status: apiErr.response?.status,
                    cleanUrl,
                    requestBody,
                    requestHeaders
                });
                return errorResponse(res, `Failed to reach Adesk Cloud API: ${apiErr.message}`, 502);
            }
            const pageRes = response.data;
            if (!pageRes || pageRes.success !== 1 || !Array.isArray(pageRes.data)) {
                await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_INVALID_RESPONSE', {
                    error: pageRes?.message || 'Invalid response format',
                    responsePayload: pageRes,
                    requestBody,
                    requestHeaders
                });
                return errorResponse(res, pageRes?.message || 'Invalid response from Adesk API', 502);
            }
            allRecords = pageRes.data;
            console.log(`[Adesk] ${allRecords.length} records fetched successfully from Adesk Cloud API`);
        }

        const records = allRecords;


        if (records.length === 0) {
            const defaultReturnPeriod = month === 'all' ? '042026' : `${month}${year.split('-')[0]}`;
            await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_PULL_EMPTY', {
                records_received: 0,
                return_period: defaultReturnPeriod,
                requestBody,
                requestHeaders,
                pulledRecords: []
            });
            return successResponse(res, {
                records_received: 0,
                records_inserted: 0,
                records_skipped: 0,
                return_period: defaultReturnPeriod
            }, 'No purchase data records found for the requested period on Adesk server');
        }

        const defaultReturnPeriod = month === 'all' ? '042026' : `${month}${year.split('-')[0]}`;

        const isSales = resolvedBookType === 'sales';

        // Map and validate incoming invoices
        const documents = [];
        let validationFailures = 0;

        for (const record of records) {
            try {
                const doc = isSales
                    ? mapSalesRecord(record, workspace.tenant_id, workspace.id, defaultReturnPeriod)
                    : mapPurchaseRecord(record, workspace.tenant_id, workspace.id, defaultReturnPeriod);
                documents.push(doc);
            } catch (valErr) {
                console.warn('[Validation Warning] Skipped invalid voucher:', valErr.message);
                validationFailures++;
            }
        }

        if (documents.length === 0) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_VALIDATION_FAILED', {
                error: 'All records failed validation',
                validationFailures,
                records_received: records.length,
                requestBody,
                requestHeaders,
                pulledRecords: records
            });
            return errorResponse(res, `All returned records (${validationFailures}) failed data validation checks (invalid GSTIN or missing fields)`, 400);
        }

        // Track and insert
        const importType = isSales ? 'SALES_REGISTER' : 'PURCHASE_REGISTER';
        const importRecord = await ConnectorImportModel.createImportRecord({
            tenantUuid: workspace.tenant_id,
            workspaceId: workspace.id,
            returnPeriod: defaultReturnPeriod,
            financialYear: year,
            importType: importType,
            extraInfo: { source: 'adesk_cloud_connector', records_count: records.length, year, quarter, month, validation_failures: validationFailures },
            userEmail: 'connector@adesk-cloud'
        });

        const result = isSales
            ? await ConnectorImportModel.bulkInsertSales(documents)
            : await ConnectorImportModel.bulkInsertPurchase(documents);

        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'All records rejected as duplicates'
            });
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_DUPLICATES', {
                error: 'All records rejected as duplicates',
                records_received: records.length,
                import_id: importRecord.import_filing_id,
                requestBody,
                requestHeaders,
                pulledRecords: records
            });
            return errorResponse(res, 'All returned invoices were already registered in the system (duplicates skipped)', 400);
        }

        await ConnectorImportModel.updateImportStatus(
            importRecord.import_filing_id,
            'Completed',
            result.inserted,
            {
                added_invoices: result.addedInvoices,
                duplicate_invoices: result.duplicateInvoices,
                skipped_validation: validationFailures
            }
        );

        // Trigger NATS reconciliation
        try {
            await publishMessage('book-data-imported', JSON.stringify({
                tenant_id: workspace.tenant_id,
                workspace_id: workspace.id,
                return_period: defaultReturnPeriod,
                import_type: isSales ? 'api_connector_sales' : 'api_connector_purchases'
            }));
        } catch (natsErr) {
            console.error('Failed to publish reconciliation event to NATS:', natsErr.message);
        }

        await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_PULL_SUCCESS', {
            records_received: records.length,
            records_inserted: result.inserted,
            records_skipped: result.duplicateInvoices.length + validationFailures,
            validation_failures: validationFailures,
            return_period: defaultReturnPeriod,
            import_id: importRecord.import_filing_id,
            requestBody,
            requestHeaders,
            pulledRecords: records
        });

        return successResponse(res, {
            records_received: records.length,
            records_inserted: result.inserted,
            records_skipped: result.duplicateInvoices.length + validationFailures,
            validation_failures: validationFailures,
            return_period: defaultReturnPeriod
        }, 'Adesk Cloud data synchronized successfully and reconciliations fired!');

    } catch (err) {
        console.error('Adesk sync pull process failed:', err);
        await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_ERROR', {
            error: err.message,
            requestBody: typeof requestBody !== 'undefined' ? requestBody : undefined,
            requestHeaders: typeof requestHeaders !== 'undefined' ? requestHeaders : undefined
        });
        return errorResponse(res, err.message || 'An unexpected error occurred during manual sync pull.', 500);
    }
};

/**
 * POST /connectors/mock-adesk
 * Simulates external Adesk Cloud Accounting Software Server.
 * Authenticates via base64 API key header and yields dynamic purchase registers.
 */
const mockAdeskServer = async (req, res) => {
    try {
        const apiKeyHeader = req.headers['api_key'] || req.headers['x-api-key'] || req.headers['authorization'];
        if (!apiKeyHeader) {
            return res.status(400).json({ success: 0, message: 'Missing api_key or Authorization header' });
        }

        const rawToken = apiKeyHeader.startsWith('Bearer ') ? apiKeyHeader.substring(7) : apiKeyHeader;

        let decoded;
        try {
            decoded = Buffer.from(rawToken, 'base64').toString('ascii');
        } catch (decodeErr) {
            return res.status(400).json({ success: 0, message: 'API key is not a valid base64 string' });
        }

        const parts = decoded.split('@@');
        if (parts.length !== 3) {
            return res.status(400).json({ success: 0, message: 'Invalid API key format. Expected tenant_uuid@@org_uuid@@org_gstn' });
        }

        const [tenantUuid, orgUuid, orgGstn] = parts;

        // Perform validation: must be valid non-empty string codes and valid GSTIN
        if (!tenantUuid || tenantUuid.trim() === '') {
            return res.status(400).json({ success: 0, message: `Invalid tenant UUID or project code: "${tenantUuid}"` });
        }
        if (!orgUuid || orgUuid.trim() === '') {
            return res.status(400).json({ success: 0, message: `Invalid organization UUID or org code: "${orgUuid}"` });
        }
        if (!isValidGSTIN(orgGstn)) {
            return res.status(400).json({ success: 0, message: `Invalid GSTIN format: "${orgGstn}"` });
        }

        const { type, start_date, end_date } = req.body;

        if (type === 'ping') {
            return res.status(200).json({
                success: 1,
                message: 'Adesk Cloud mock server ping successful',
                apiVersion: 'v1.4.12',
                status: 'operational',
                environment: 'production'
            });
        }

        if (!type || !start_date || !end_date) {
            return res.status(400).json({ success: 0, message: 'type, start_date, and end_date are required' });
        }

        const reqBookType = req.body.book_type || req.body.type || type || 'purchase';
        if (reqBookType !== 'purchase' && reqBookType !== 'sales') {
            return res.status(400).json({ success: 0, message: 'This connector only supports "purchase" and "sales" registers' });
        }

        const start = new Date(start_date);
        const end = new Date(end_date);

        const path = require('path');
        const fs = require('fs');
        const jsonPath = path.join(__dirname, 'mock-adesk-data.json');

        let records = [];

        if (fs.existsSync(jsonPath)) {
            try {
                const rawData = fs.readFileSync(jsonPath, 'utf8');
                let allMockRecords = JSON.parse(rawData);

                // If a single object is provided instead of an array, wrap it in an array
                if (!Array.isArray(allMockRecords)) {
                    allMockRecords = [allMockRecords];
                }

                // Filter records whose original vchr_date falls inside [start, end]
                let matchedRecords = allMockRecords.filter(row => {
                    const rowDateStr = row.vchr_date || row.supplier_invoice_date;
                    if (!rowDateStr) return false;
                    const rowDate = new Date(rowDateStr);
                    return rowDate >= start && rowDate <= end;
                });

                // If no records fall inside the range, fallback to generating dynamic dates
                // to make sure it NEVER returns 0 records when the user queries a different range
                if (matchedRecords.length === 0) {
                    matchedRecords = allMockRecords.map((row, idx) => {
                        const clonedRow = { ...row };

                        // Compute a dynamic date within the requested start_date and end_date
                        const dStart = new Date(start_date);
                        const dEnd = new Date(end_date);
                        const diffTime = Math.abs(dEnd - dStart);
                        const randomOffset = Math.floor((idx / allMockRecords.length) * diffTime);
                        const dynamicDate = new Date(dStart.getTime() + randomOffset);

                        // Format as YYYY-MM-DD
                        const yyyy = dynamicDate.getFullYear();
                        const mm = String(dynamicDate.getMonth() + 1).padStart(2, '0');
                        const dd = String(dynamicDate.getDate()).padStart(2, '0');
                        const formattedDate = `${yyyy}-${mm}-${dd}`;

                        clonedRow.vchr_date = formattedDate;
                        if (clonedRow.supplier_invoice_date) {
                            clonedRow.supplier_invoice_date = formattedDate;
                        }
                        return clonedRow;
                    });
                }

                // Dynamically map types based on requested book type
                records = matchedRecords.map(row => {
                    const clonedRow = { ...row };

                    if (reqBookType === 'sales') {
                        clonedRow.vchr_type = 'SALES';
                        clonedRow.vchr_prefix = 'SA';
                        clonedRow.vchr_full_number = `SA${clonedRow.vchr_no}`;

                        // For sales B2B, ensure a valid customer GSTIN is present
                        const cat = (clonedRow.gstr_category || '').toUpperCase();
                        if (cat.includes('B2B')) {
                            // Dynamically ensure customer GSTIN is different from organization's own GSTIN (orgGstn) to avoid self-sales
                            clonedRow.party_gstn_no = clonedRow.party_gstn_no || (orgGstn === '24AALFA9789K1ZO' ? '24GENPS9883E1ZN' : '24AALFA9789K1ZO');
                        }
                    } else {
                        clonedRow.vchr_type = clonedRow.vchr_type === 'SALES' ? 'PUR' : clonedRow.vchr_type;
                        clonedRow.vchr_prefix = clonedRow.vchr_prefix === 'SA' ? 'PA' : clonedRow.vchr_prefix;
                    }

                    return clonedRow;
                });
            } catch (jsonErr) {
                console.error('Error reading mock Adesk JSON data:', jsonErr.message);
            }
        } else {
            console.warn(`Mock data file not found at: ${jsonPath}`);
        }

        // Write the fetched records directly into the local PostgreSQL database for a zero-friction developer experience
        const isInternalOrchestrator = req.headers['x-adesk-sync-source'] === 'saas-orchestrator';
        if (records.length > 0 && !isInternalOrchestrator) {
            try {
                // Resolve the actual, valid tenant_id and workspace_id from the database to prevent foreign key constraint violations
                let resolvedTenantUuid = tenantUuid;
                let resolvedWorkspaceId = orgUuid;

                try {
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgUuid);
                    let dbWorkspace;
                    if (isUuid) {
                        dbWorkspace = await knex('workspaces')
                            .where({ id: orgUuid })
                            .select('id', 'tenant_id')
                            .first();
                    } else {
                        dbWorkspace = await knex('workspaces')
                            .where({ workspace_code: orgUuid })
                            .select('id', 'tenant_id')
                            .first();
                    }

                    if (dbWorkspace) {
                        resolvedTenantUuid = dbWorkspace.tenant_id;
                        resolvedWorkspaceId = dbWorkspace.id;
                    } else {
                        const keyRec = await knex('workspace_api_keys')
                            .whereRaw("extrainfo->>'project_code' = ?", [tenantUuid])
                            .andWhereRaw("extrainfo->>'org_code' = ?", [orgUuid])
                            .first();
                        if (keyRec) {
                            resolvedTenantUuid = keyRec.tenant_id;
                            resolvedWorkspaceId = keyRec.workspace_id;
                        }
                    }
                } catch (lookupErr) {
                    console.warn('[Mock Server] Failed to lookup workspace tenant_id:', lookupErr.message);
                }

                // Ensure the tax period and financial year exist for mapping
                const defaultReturnPeriod = getPeriodFromDate(start_date);
                const documents = [];
                const isSales = reqBookType === 'sales';

                for (const record of records) {
                    try {
                        const doc = isSales
                            ? mapSalesRecord(record, resolvedTenantUuid, resolvedWorkspaceId, defaultReturnPeriod)
                            : mapPurchaseRecord(record, resolvedTenantUuid, resolvedWorkspaceId, defaultReturnPeriod);
                        documents.push(doc);
                    } catch (valErr) {
                        console.warn('[Mock Direct Ingest Warning] Skipped invalid voucher:', valErr.message);
                    }
                }

                if (documents.length > 0) {
                    const startYear = start.getFullYear();
                    const endYearAbbr = (startYear + 1).toString().slice(-2);
                    const financialYear = `${startYear}-${endYearAbbr}`;

                    // Create database import log entry
                    await ConnectorImportModel.createImportRecord({
                        tenantUuid: resolvedTenantUuid,
                        workspaceId: resolvedWorkspaceId,
                        returnPeriod: defaultReturnPeriod,
                        financialYear: financialYear,
                        importType: isSales ? 'SALES_REGISTER' : 'PURCHASE_REGISTER',
                        extraInfo: { source: 'adesk_direct_mock_postman_push', records_count: records.length },
                        userEmail: 'connector@adesk-postman'
                    });

                    // Bulk insert documents directly into database, ignoring duplicates
                    if (isSales) {
                        await ConnectorImportModel.bulkInsertSales(documents);
                    } else {
                        await ConnectorImportModel.bulkInsertPurchase(documents);
                    }
                    console.log(`[Mock Server] Direct Ingested ${documents.length} ${reqBookType} vouchers into database successfully.`);
                }
            } catch (dbErr) {
                console.error('[Mock Server] Direct database ingestion failed:', dbErr.message);
            }
        }

        return res.status(200).json({
            success: 1,
            message: 'record found and directly synchronized in database',
            data: records
        });

    } catch (serverErr) {
        console.error('Mock Adesk server request failed:', serverErr);
        return res.status(500).json({ success: 0, message: serverErr.message || 'Integrated server error' });
    }
};

/**
 * POST /connectors/adesk/test-connection
 * Pings the configured Adesk Cloud API Server to verify reachability and credentials.
 */
const testConnection = async (req, res) => {
    let workspace = null;
    try {
        const { workspace_id, cloudUrl, apiToken } = req.body;

        if (!workspace_id) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_TEST_INVALID_INPUT', { error: 'workspace_id is required' });
            return errorResponse(res, 'workspace_id is required', 400);
        }
        if (!cloudUrl || !apiToken) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_TEST_INVALID_INPUT', { error: 'cloudUrl and apiToken are required' });
            return errorResponse(res, 'cloudUrl and apiToken are required', 400);
        }

        // Fetch workspace details to get tenant_id and gstin for base64 key
        workspace = await knex('workspaces')
            .where({ id: workspace_id })
            .select('id', 'tenant_id', 'gstn')
            .first();

        if (!workspace) {
            await logPullActivity(req, null, 'Failed', 'CONNECTOR_ADESK_TEST_WORKSPACE_NOT_FOUND', { error: 'Workspace not found' });
            return errorResponse(res, 'Workspace not found', 404);
        }

        // Auto-detect: real Adesk API (GET + X-TIG-API-KEY) vs mock server (POST + base64)
        const isMockServer = cloudUrl.includes('mock-adesk');
        let response;
        const startTime = Date.now();

        try {
            if (isMockServer) {
                const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
                const encodedKey = Buffer.from(rawKey).toString('base64');
                response = await axios.post(cloudUrl, { type: 'ping' }, {
                    headers: { 'api_key': encodedKey, 'x-api-key': encodedKey, 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
                    timeout: 5000
                });
            } else {
                // Real Adesk API: POST with 1 row just to verify credentials and reachability
                const cleanUrl = cloudUrl.split('?')[0];
                const today = new Date().toISOString().split('T')[0];
                const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
                const encodedKey = Buffer.from(rawKey).toString('base64');
                response = await axios.post(cleanUrl, {
                    type: 'ping',
                    fyear: '2025-2026',
                    start_date: today,
                    end_date: today,
                    book_type: 'all',
                    gstn_number: workspace.gstn,
                    rows: 1
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'x-api-key': encodedKey,
                        'api_key': encodedKey,
                        'X-TIG-API-KEY': apiToken,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'tenant-id': workspace.tenant_id,
                        'workspace-id': String(workspace.id),
                        'user-id': req.user ? (req.user.db_id || req.user.id || req.user.sub) : '',
                        'user-name': req.user ? (req.user.name || 'User') : '',
                        'user-email': req.user ? (req.user.email || 'user@example.com') : ''
                    },
                    timeout: 20000
                });
            }
        } catch (apiErr) {
            const latency = `${Date.now() - startTime}ms`;
            if (apiErr.response) {
                if (apiErr.response.status === 401 || apiErr.response.status === 403) {
                    await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_TEST_AUTH_FAILED', { error: 'Authentication failed', cloudUrl });
                    return errorResponse(res, `Authentication failed (HTTP ${apiErr.response.status}). Please verify your API Key.`, 401);
                }
                // Any other HTTP response still means server is reachable
                await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_TEST_SUCCESS', { message: `Server reachable (Status ${apiErr.response.status})`, cloudUrl, latency });
                return successResponse(res, { status: 'operational', latency, message: `Adesk Server is reachable (HTTP ${apiErr.response.status})` }, 'Adesk Cloud API Server is reachable!');
            }
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_TEST_CONNECTION_FAILED', { error: apiErr.message, cloudUrl });
            return errorResponse(res, `Cannot reach Adesk Cloud API at ${cloudUrl}. Error: ${apiErr.message}`, 502);
        }

        const latency = `${Date.now() - startTime}ms`;
        const data = response.data;
        await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_TEST_SUCCESS', { cloudUrl, latency });
        return successResponse(res, {
            status: 'operational',
            latency,
            apiVersion: data.apiVersion || data._meta?.resource || 'v1',
            environment: data.environment || 'production',
            message: data.message || 'Connected to Adesk Cloud API successfully!'
        }, 'Successfully connected to Adesk Cloud API Server!');

    } catch (err) {
        console.error('Adesk connection test failed:', err);
        await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_TEST_ERROR', { error: err.message });
        return errorResponse(res, err.message || 'An unexpected error occurred during connection check.', 500);
    }
};

module.exports = {
    pullPurchaseData,
    mockAdeskServer,
    testConnection
};
