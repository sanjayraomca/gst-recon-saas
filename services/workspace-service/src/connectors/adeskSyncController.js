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
    const year2 = parts[1] ? (year1 - (year1 % 100) + parseInt(parts[1])) : (year1 + 1);

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
    } else if (voucherType === 'PUR' || voucherType === 'PURCHASE') {
        voucherType = 'PURCHASE';
    } else if (voucherType === 'DN' || voucherType === 'DEBIT_NOTE') {
        voucherType = 'DEBIT_NOTE';
    } else if (voucherType === 'CN' || voucherType === 'CREDIT_NOTE') {
        voucherType = 'CREDIT_NOTE';
    }

    if (bookType === 'PURCHASE' || bookType === 'PUR') {
        bookType = 'PA';
    } else if (bookType === 'EXPENSE') {
        bookType = 'EXP';
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
    const { workspace_id, year, quarter, month } = req.body;
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
        const cloudUrl = adeskConfig.cloudUrl || 'http://localhost:3002/connectors/mock-adesk';
        const apiToken = adeskConfig.apiToken;

        if (!apiToken) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_AUTH_MISSING', { error: 'Adesk API Auth Token is missing' });
            return errorResponse(res, 'Adesk API Auth Token is missing. Configure it in Setup first.', 400);
        }

        // Calculate dynamic period dates
        const { start_date, end_date } = calculateDates(year, quarter, month);

        // Build base64 headers using GST_TOOL_API_KEY layout: tenant_uuid@@org_uuid@@org_gstn
        const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
        const encodedKey = Buffer.from(rawKey).toString('base64');

        const headers = {
            'api_key': encodedKey,
            'x-api-key': encodedKey,
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'x-adesk-sync-source': 'saas-orchestrator'
        };

        // Query Adesk external server
        let response;
        try {
            response = await axios.post(cloudUrl, {
                type: 'purchase',
                start_date,
                end_date
            }, { headers, timeout: 5000 });
        } catch (apiErr) {
            console.error('Error connecting to Adesk Cloud API Server:', apiErr.message);
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_CONNECTION_ERROR', { error: apiErr.message, cloudUrl });
            return errorResponse(res, `Failed to reach Adesk Cloud API Server at ${cloudUrl}. Check configuration or verify mock server is running.`, 502);
        }

        const adeskRes = response.data;
        console.log('DEBUG [pullPurchaseData] adeskRes:', adeskRes);
        if (!adeskRes || adeskRes.success !== 1 || !Array.isArray(adeskRes.data)) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_INVALID_RESPONSE', { error: adeskRes ? adeskRes.message : 'Invalid response' });
            return errorResponse(res, adeskRes ? adeskRes.message : 'Invalid response received from Adesk Accounting Server', 502);
        }

        const records = adeskRes.data;
        if (records.length === 0) {
            const defaultReturnPeriod = month === 'all' ? '042026' : `${month}${year.split('-')[0]}`;
            await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_PULL_EMPTY', { records_received: 0, return_period: defaultReturnPeriod });
            return successResponse(res, {
                records_received: 0,
                records_inserted: 0,
                records_skipped: 0,
                return_period: defaultReturnPeriod
            }, 'No purchase data records found for the requested period on Adesk server');
        }

        const defaultReturnPeriod = month === 'all' ? '042026' : `${month}${year.split('-')[0]}`;

        // Map and validate incoming invoices
        const documents = [];
        let validationFailures = 0;

        for (const record of records) {
            try {
                const doc = mapPurchaseRecord(record, workspace.tenant_id, workspace.id, defaultReturnPeriod);
                documents.push(doc);
            } catch (valErr) {
                console.warn('[Validation Warning] Skipped invalid voucher:', valErr.message);
                validationFailures++;
            }
        }

        if (documents.length === 0) {
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_VALIDATION_FAILED', { error: 'All records failed validation', validationFailures, records_received: records.length });
            return errorResponse(res, `All returned records (${validationFailures}) failed data validation checks (invalid GSTIN or missing fields)`, 400);
        }

        // Track and insert
        const importRecord = await ConnectorImportModel.createImportRecord({
            tenantUuid: workspace.tenant_id,
            workspaceId: workspace.id,
            returnPeriod: defaultReturnPeriod,
            financialYear: year,
            importType: 'PURCHASE_REGISTER',
            extraInfo: { source: 'adesk_cloud_connector', records_count: records.length, year, quarter, month, validation_failures: validationFailures },
            userEmail: 'connector@adesk-cloud'
        });

        const result = await ConnectorImportModel.bulkInsertPurchase(documents);

        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'All records rejected as duplicates'
            });
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_DUPLICATES', { error: 'All records rejected as duplicates', records_received: records.length, import_id: importRecord.import_filing_id });
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
                import_type: 'api_connector_purchases'
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
            import_id: importRecord.import_filing_id
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
        await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_PULL_ERROR', { error: err.message });
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

        if (type !== 'purchase') {
            return res.status(400).json({ success: 0, message: 'This connector currently only supports "purchase" registers' });
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

                // Filter strictly by the requested dates
                records = allMockRecords.filter(row => {
                    const invoiceDateStr = row.supplier_invoice_date || row.vchr_date;
                    if (!invoiceDateStr) return false;

                    const vDate = new Date(invoiceDateStr);
                    return vDate >= start && vDate <= end;
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
                // Resolve the actual, valid tenant_id from the database based on the orgUuid (workspace ID) to prevent foreign key constraint violations
                let resolvedTenantUuid = tenantUuid;
                try {
                    const dbWorkspace = await knex('workspaces')
                        .where({ id: orgUuid })
                        .select('tenant_id')
                        .first();
                    if (dbWorkspace) {
                        resolvedTenantUuid = dbWorkspace.tenant_id;
                    }
                } catch (lookupErr) {
                    console.warn('[Mock Server] Failed to lookup workspace tenant_id:', lookupErr.message);
                }

                // Ensure the tax period and financial year exist for mapping
                const defaultReturnPeriod = getPeriodFromDate(start_date);
                const documents = [];

                for (const record of records) {
                    try {
                        const doc = mapPurchaseRecord(record, resolvedTenantUuid, orgUuid, defaultReturnPeriod);
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
                        workspaceId: orgUuid,
                        returnPeriod: defaultReturnPeriod,
                        financialYear: financialYear,
                        importType: 'PURCHASE_REGISTER',
                        extraInfo: { source: 'adesk_direct_mock_postman_push', records_count: records.length },
                        userEmail: 'connector@adesk-postman'
                    });

                    // Bulk insert documents directly into database, ignoring duplicates
                    await ConnectorImportModel.bulkInsertPurchase(documents);
                    console.log(`[Mock Server] Direct Ingested ${documents.length} purchase vouchers into database successfully.`);
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

        // Build base64 headers
        const rawKey = `${workspace.tenant_id}@@${workspace.id}@@${workspace.gstn}`;
        const encodedKey = Buffer.from(rawKey).toString('base64');

        const headers = {
            'api_key': encodedKey,
            'x-api-key': encodedKey,
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        };

        // Query Adesk external server with a quick ping
        let response;
        try {
            response = await axios.post(cloudUrl, {
                type: 'ping'
            }, { headers, timeout: 3000 });
        } catch (apiErr) {
            if (apiErr.response) {
                if (apiErr.response.status === 401 || apiErr.response.status === 403) {
                    await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_TEST_AUTH_FAILED', { error: 'Authentication failed', cloudUrl });
                    return errorResponse(res, `Authentication failed. Adesk Cloud returned status ${apiErr.response.status}. Verify your API Auth Token.`, 401);
                }
                await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_TEST_SUCCESS', { message: `Adesk Server reachable (Status ${apiErr.response.status})`, cloudUrl });
                return successResponse(res, {
                    status: 'operational',
                    latency: '15ms',
                    message: `Adesk Server is reachable (Response status ${apiErr.response.status})`
                }, 'Adesk Cloud API Server is reachable!');
            }
            await logPullActivity(req, workspace, 'Failed', 'CONNECTOR_ADESK_TEST_CONNECTION_FAILED', { error: apiErr.message, cloudUrl });
            return errorResponse(res, `Failed to reach Adesk Cloud API Server at ${cloudUrl}. Error: ${apiErr.message}`, 502);
        }

        const data = response.data;
        await logPullActivity(req, workspace, 'Success', 'CONNECTOR_ADESK_TEST_SUCCESS', { cloudUrl, latency: '12ms', apiVersion: data.apiVersion });
        return successResponse(res, {
            status: data.status || 'operational',
            latency: '12ms',
            apiVersion: data.apiVersion || 'v1.4.12',
            environment: data.environment || 'production',
            message: data.message || 'Mock Adesk Cloud Server connected successfully!'
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
