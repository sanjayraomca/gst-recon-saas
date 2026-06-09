const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const jwt = require('jsonwebtoken');

const logThirdPartySync = async (req, status, respBody, options = {}) => {
    try {
        const knex = require('../../../shared/src/db/connection');
        const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.connection && req.connection.remoteAddress) || null;
        const userAgent = req.headers['user-agent'] || null;

        const platform = req.body?.platform || options.platform || req.headers['platform'] || req.headers['x-platform'] || 'API';
        const rawApiKey = req.headers['x-api-key'] || req.headers['x-org-token'] || req.headers['org-token'] || null;
        const accessKey = rawApiKey ? (typeof rawApiKey === 'string' && rawApiKey.length > 250 ? `${rawApiKey.substring(0, 240)}...` : rawApiKey) : null;

        await knex('tig_inbound_outbound_log').insert({
            type: 'sync',
            request_type: 'inbound_sync',
            user_id: options.userId || null,
            tenant_id: options.tenantId || null,
            org_id: options.workspaceId || null,
            access_key: accessKey,
            platform: platform,
            t_params: { local_api_response: respBody },
            t_resp_headers: null,
            t_resp_body: req.body || null,
            ip_address: ip,
            user_agent: userAgent,
            status: status,
            extrainfo: options.extrainfo || null
        });
    } catch (err) {
        console.error('[logThirdPartySync] Failed to write inbound sales sync log:', err.message);
    }
};

/**
 * Synchronise sales invoices from third-party platforms (Tally, Zoho) in Adesk format
 */
const syncThirdPartySales = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');
        const ConnectorImportModel = require('../connectors/connectorImportModel');

        // ─── Authentication: 3-tier system ───────────────────────────────────────
        const rawApiKey = req.headers['x-api-key'];
        const rawOrgToken = req.headers['x-org-token'] || req.headers['org-token'];

        let workspace = null;
        let platform = null;
        let resolvedUserId = null;

        if (rawApiKey) {
            // Tier 1: Permanent API Key
            workspace = await knex('workspaces')
                .whereRaw("settings->>'third_party_api_key' = ?", [rawApiKey])
                .first();

            if (!workspace) {
                const resp = { success: false, error: 'Invalid or revoked API key' };
                await logThirdPartySync(req, 'error', resp, { platform: 'API' });
                return errorResponse(res, 'Invalid or revoked API key', 401);
            }

            const settings = typeof workspace.settings === 'string'
                ? JSON.parse(workspace.settings)
                : (workspace.settings || {});

            platform = settings.third_party_api_key_platform || (req.headers['platform'] || req.headers['x-platform'] || 'API');
            resolvedUserId = settings.third_party_api_key_user_id || workspace.id;

            // Update last used timestamp
            settings.third_party_api_key_last_used_at = new Date().toISOString();
            knex('workspaces')
                .where({ id: workspace.id })
                .update({ settings: JSON.stringify(settings) })
                .catch(() => { });

        } else if (rawOrgToken) {
            // Tier 2: Org-scoped JWT
            let orgClaims;
            try {
                const jwtSecret = process.env.JWT_SECRET || 'change-this-secret-in-production';
                orgClaims = jwt.verify(rawOrgToken, jwtSecret, { issuer: 'gst-recon-tool' });
            } catch (jwtErr) {
                const errMsg = `Invalid or expired org_access_token: ${jwtErr.message}. Please login again.`;
                const resp = { success: false, error: errMsg };
                await logThirdPartySync(req, 'error', resp, { platform: 'API' });
                return errorResponse(res, errMsg, 401);
            }

            workspace = await knex('workspaces').where({ id: orgClaims.workspace_id }).first();
            if (!workspace) {
                const resp = { success: false, error: 'Workspace referenced in token not found' };
                await logThirdPartySync(req, 'error', resp, { platform: orgClaims.platform });
                return errorResponse(res, 'Workspace referenced in token not found', 404);
            }

            platform = orgClaims.platform;
            resolvedUserId = orgClaims.user_id;

        } else {
            // Tier 3: Legacy headers (requires Bearer JWT)
            platform = req.headers['platform'] || req.headers['x-platform'];
            const orgGstNo = req.headers['organization-gstno'] || req.headers['x-organization-gstno'];

            if (!platform || !orgGstNo) {
                const errMsg = 'Authentication required. Provide one of: x-api-key header, x-org-token header, or platform + organization-gstno headers with Bearer JWT.';
                const resp = { success: false, error: errMsg };
                await logThirdPartySync(req, 'error', resp, { platform: platform || 'API' });
                return errorResponse(res, errMsg, 400);
            }

            workspace = await knex('workspaces').where({ gstn: orgGstNo.trim().toUpperCase() }).first();
            if (!workspace) {
                const errMsg = `Workspace with GSTIN ${orgGstNo} not found`;
                const resp = { success: false, error: errMsg };
                await logThirdPartySync(req, 'error', resp, { platform });
                return errorResponse(res, errMsg, 404);
            }

            const user = req.user;
            if (!user) {
                const errMsg = 'Bearer token required when using header-based auth';
                const resp = { success: false, error: errMsg };
                await logThirdPartySync(req, 'error', resp, { platform, workspaceId: workspace.id, tenantId: workspace.tenant_id });
                return errorResponse(res, errMsg, 401);
            }

            const isSuperAdmin = user.role === 'SUPER_ADMIN' || (user.groups && user.groups.includes('super-admin'));
            if (!isSuperAdmin) {
                const access = await knex('workspace_users')
                    .where({ workspace_id: workspace.id, user_id: user.db_id || user.id, invitation_status: 'ACTIVE' })
                    .whereNull('removed_at')
                    .first();
                if (!access) {
                    const errMsg = 'Access denied for the specified workspace';
                    const resp = { success: false, error: errMsg };
                    await logThirdPartySync(req, 'error', resp, { platform, workspaceId: workspace.id, tenantId: workspace.tenant_id, userId: user.db_id || user.id });
                    return errorResponse(res, errMsg, 403);
                }
            }

            resolvedUserId = user.db_id || user.id;
        }

        const user = req.user || { db_id: resolvedUserId, id: resolvedUserId, email: 'api-key-auth' };

        const rawVouchers = Array.isArray(req.body) ? req.body : (req.body.headers || req.body.vouchers || req.body.records || []);
        if (rawVouchers.length === 0) {
            const resp = {
                records_received: 0,
                records_inserted: 0,
                records_skipped: 0
            };
            await logThirdPartySync(req, 'success', { success: true, data: resp, message: 'No vouchers provided to sync' }, {
                platform,
                workspaceId: workspace.id,
                tenantId: workspace.tenant_id,
                userId: user.db_id || user.id
            });
            return successResponse(res, resp, 'No vouchers provided to sync');
        }

        const mappedDocs = [];
        for (const record of rawVouchers) {
            const vchrDate = record.invoice_date || record.vchr_date || null;

            // Derive returnPeriod
            let returnPeriod = '';
            if (vchrDate) {
                const parts = vchrDate.split('-');
                if (parts.length >= 2) {
                    returnPeriod = `${parts[1]}${parts[0]}`;
                }
            }
            if (!returnPeriod) {
                const now = new Date();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const yyyy = String(now.getFullYear());
                returnPeriod = `${mm}${yyyy}`;
            }

            const invoiceNumber = String(
                record.invoice_number ||
                record.vchr_full_number ||
                record.vchr_no ||
                record.book_vchr_no ||
                ''
            ).trim();

            if (!invoiceNumber) {
                continue;
            }

            const customerGstin = String(record.customer_gstin || record.party_gstn_no || record.billing_gstin || '').trim().toUpperCase();
            const customerName = String(record.customer_name || record.party_name || record.billing_name || 'Generic Customer').trim();

            let bookType = (record.book_type || record.vchr_prefix || 'SA').trim().toUpperCase();
            let invoiceType = (record.invoice_type || record.voucher_type || 'B2B').trim().toUpperCase();

            if (invoiceType === 'SR' || invoiceType === 'SALES_RETURN' || bookType === 'SR') {
                bookType = 'SR';
                invoiceType = 'B2B';
            } else if (invoiceType === 'SA' || invoiceType === 'SALES' || invoiceType === 'SALES_INVOICE' || bookType === 'SA') {
                bookType = 'SA';
                invoiceType = 'B2B';
            } else if (invoiceType === 'DN' || invoiceType === 'DEBIT_NOTE' || bookType === 'DN') {
                bookType = 'DN';
                invoiceType = 'DEBIT_NOTE';
            } else if (invoiceType === 'CN' || invoiceType === 'CREDIT_NOTE' || bookType === 'CN') {
                bookType = 'CN';
                invoiceType = 'CREDIT_NOTE';
            } else {
                if (bookType.includes('SR')) {
                    bookType = 'SR';
                    invoiceType = 'B2B';
                } else if (bookType.includes('DN')) {
                    bookType = 'DN';
                    invoiceType = 'DEBIT_NOTE';
                } else if (bookType.includes('CN')) {
                    bookType = 'CN';
                    invoiceType = 'CREDIT_NOTE';
                } else {
                    bookType = 'SA';
                    invoiceType = 'B2B';
                }
            }

            // Fallback to B2C if no customer GSTIN
            if (invoiceType === 'B2B' && !customerGstin) {
                invoiceType = 'B2C_SMALL';
            }

            const taxableTotal = parseFloat(record.total_taxable_value || record.taxable_value || record.taxable_amount || record.total_taxable_amount || 0);
            let netAmount = parseFloat(record.total_invoice_value || record.row_wise_total_amount || record.net_amount || record.total_value || record.invoice_amount || 0);
            const totalIgstAmount = parseFloat(record.igst || record.igst_amount || record.total_igst_tax_amount || 0);
            const totalCgstAmount = parseFloat(record.cgst || record.cgst_amount || record.total_cgst_tax_amount || 0);
            const totalSgstAmount = parseFloat(record.sgst || record.sgst_amount || record.total_sgst_tax_amount || 0);
            const totalCessAmount = parseFloat(record.cess || record.cess_amount || record.total_cess_tax_amount || 0);
            let roundOff = parseFloat(record.round_off || record.round_off_amount || 0);

            // Fix corrupt/incorrect round-off and invoice amount
            const expectedSum = taxableTotal + totalIgstAmount + totalCgstAmount + totalSgstAmount + totalCessAmount;
            if (Math.abs(roundOff) > 10.0 || (netAmount > 0 && Math.abs(expectedSum - netAmount) > 10.0)) {
                const expectedRounded = Math.round(expectedSum);
                roundOff = Math.round((expectedRounded - expectedSum) * 100) / 100;
                netAmount = expectedRounded;
            }

            const header = {
                tenant_id: workspace.tenant_id,
                workspace_id: workspace.id,
                invoice_number: invoiceNumber,
                invoice_date: vchrDate,
                book_type: bookType,
                invoice_type: invoiceType,
                customer_name: customerName,
                customer_gstin: customerGstin || null,
                total_taxable_value: taxableTotal,
                total_invoice_value: netAmount,
                total_igst: totalIgstAmount,
                total_cgst: totalCgstAmount,
                total_sgst: totalSgstAmount,
                total_cess: totalCessAmount,
                round_off: roundOff,
                place_of_supply: record.place_of_supply || record.party_state_id || null,
                reverse_charge: record.reverse_charge || (record.reverse_charge === 'Yes') || false,
                is_amendment: record.is_amendment || false,
                filing_period: returnPeriod,
                return_period: returnPeriod,
                platform: platform || record.platform || null,
                t_extra_info: {
                    source: 'third_party_api_sync',
                    platform: platform,
                    original_data: record
                }
            };

            const items = [{
                hsn_sac_code: record.hsn_sac_code || record.hsn_code || null,
                description: record.description || 'Voucher details',
                quantity: 1,
                uom: 'NOS',
                unit_rate: taxableTotal,
                taxable_value: taxableTotal,
                gst_rate_percent: parseFloat(record.gst_rate_percent || record.tax_per || 0),
                igst_amount: totalIgstAmount,
                cgst_amount: totalCgstAmount,
                sgst_amount: totalSgstAmount,
                cess_amount: totalCessAmount,
                total_amount_with_tax: netAmount
            }];

            mappedDocs.push({ header, items });
        }

        // Group mapped documents by invoice identity to combine split tax-rate lines
        const groupedMap = new Map();
        for (const doc of mappedDocs) {
            const header = doc.header;
            const key = `${header.invoice_number}__${header.invoice_date}`;
            if (!groupedMap.has(key)) {
                const headerClone = { ...header };
                headerClone.total_taxable_value = 0;
                headerClone.total_igst = 0;
                headerClone.total_cgst = 0;
                headerClone.total_sgst = 0;
                headerClone.total_cess = 0;
                headerClone.total_invoice_value = 0;

                groupedMap.set(key, {
                    header: headerClone,
                    items: []
                });
            }
            const existing = groupedMap.get(key);
            existing.items.push(...doc.items);
            existing.header.total_taxable_value += header.total_taxable_value;
            existing.header.total_igst += header.total_igst;
            existing.header.total_cgst += header.total_cgst;
            existing.header.total_sgst += header.total_sgst;
            existing.header.total_cess += header.total_cess;
            existing.header.total_invoice_value += header.total_invoice_value;
            if (header.round_off !== 0) {
                existing.header.round_off = header.round_off;
            }
        }
        const groupedDocs = Array.from(groupedMap.values());
        for (const doc of groupedDocs) {
            if (!doc.header.total_invoice_value || doc.header.total_invoice_value <= 0) {
                doc.header.total_invoice_value =
                    doc.header.total_taxable_value +
                    doc.header.total_igst +
                    doc.header.total_cgst +
                    doc.header.total_sgst +
                    doc.header.total_cess +
                    (doc.header.round_off || 0);
            }
            for (const k of ['total_taxable_value', 'total_igst', 'total_cgst', 'total_sgst', 'total_cess', 'total_invoice_value']) {
                doc.header[k] = Math.round(doc.header[k] * 100) / 100;
            }
        }

        const returnPeriod = groupedDocs[0]?.header?.return_period || '042025';
        const year = `${returnPeriod.substring(2)}-${String(parseInt(returnPeriod.substring(2)) + 1).slice(-2)}`;

        // Create import filing record
        const importRecord = await ConnectorImportModel.createImportRecord({
            tenantUuid: workspace.tenant_id,
            workspaceId: workspace.id,
            returnPeriod: returnPeriod,
            financialYear: year,
            importType: 'SALES_REGISTER',
            extraInfo: { source: 'third_party_sync', platform: platform, records_count: rawVouchers.length },
            userEmail: user.email || 'connector@third-party'
        });

        const result = await ConnectorImportModel.bulkInsertSales(groupedDocs, importRecord.import_filing_id);

        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'All records rejected as duplicates'
            });
            const errMsg = 'All synchronised vouchers were already registered in the system (duplicates skipped)';
            const resp = { success: false, error: errMsg };
            await logThirdPartySync(req, 'error', resp, {
                platform,
                workspaceId: workspace.id,
                tenantId: workspace.tenant_id,
                userId: user.db_id || user.id,
                extrainfo: { import_id: importRecord.import_filing_id, records_count: rawVouchers.length }
            });
            return errorResponse(res, errMsg, 400);
        }

        await ConnectorImportModel.updateImportStatus(
            importRecord.import_filing_id,
            'Completed',
            result.inserted,
            {
                added_vouchers: result.addedInvoices,
                duplicate_vouchers: result.duplicateInvoices
            }
        );

        // Publish to NATS for asynchronous book imports
        try {
            const { publishMessage } = require('../../../shared/src/nats/client');
            await publishMessage('book-data-imported', JSON.stringify({
                tenant_id: workspace.tenant_id,
                workspace_id: workspace.id,
                return_period: returnPeriod,
                import_type: 'api_connector_sales'
            }));
        } catch (natsErr) {
            console.error('Failed to publish reconciliation event to NATS:', natsErr.message);
        }

        // Log Activity
        await logActivity({
            userId: user.db_id || user.id,
            tenantId: workspace.tenant_id,
            workspaceId: workspace.id,
            actionType: 'third_party_sync',
            activityType: platform,
            entityType: 'User',
            entityId: user.db_id || user.id,
            details: {
                platform,
                records_received: rawVouchers.length,
                records_inserted: result.inserted,
                records_skipped: result.duplicateInvoices.length,
                import_id: importRecord.import_filing_id
            },
            req
        });

        const successData = {
            records_received: rawVouchers.length,
            records_inserted: result.inserted,
            records_skipped: result.duplicateInvoices.length,
            return_period: returnPeriod
        };
        await logThirdPartySync(req, 'success', {
            success: true,
            data: successData,
            message: 'Sales data synchronized successfully'
        }, {
            platform,
            workspaceId: workspace.id,
            tenantId: workspace.tenant_id,
            userId: user.db_id || user.id,
            extrainfo: { import_id: importRecord.import_filing_id }
        });
        return successResponse(res, successData, 'Sales data synchronized successfully');

    } catch (error) {
        console.error('Third-party sales sync error:', error);
        const resp = { success: false, error: error.message };
        await logThirdPartySync(req, 'error', resp, {
            platform: platform || 'API',
            workspaceId: workspace?.id,
            tenantId: workspace?.tenant_id,
            userId: user?.db_id || user?.id
        });
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    syncThirdPartySales
};
