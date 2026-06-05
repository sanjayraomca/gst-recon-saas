const PurchaseInvoiceModel = require('../models/purchaseInvoiceModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const jwt = require('jsonwebtoken');

/**
 * Get all purchase invoices with filters and pagination
 */
const getAllInvoices = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const filters = {
            gstin_id: req.query.gstin_id,
            supplier_id: req.query.supplier_id,
            invoice_date_from: req.query.invoice_date_from,
            invoice_date_to: req.query.invoice_date_to,
            itc_eligibility_status: req.query.itc_eligibility_status,
            reverse_charge: req.query.reverse_charge === 'true' ? true : req.query.reverse_charge === 'false' ? false : undefined,
            payment_status: req.query.payment_status,
            search: req.query.search
        };

        const pagination = {
            page: parseInt(req.query.page) || 1,
            page_size: Math.min(parseInt(req.query.page_size) || 50, 100)
        };

        const result = await PurchaseInvoiceModel.getAll(workspaceId, filters, pagination);
        
        // Log Activity
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'VIEW_ALL_PURCHASE_INVOICES',
            entityType: 'BOOK_DATA',
            details: { 
                page_name: 'Purchase Register',
                filters, 
                pagination 
            },
            req
        });

        return successResponse(res, {
            invoices: result.data,
            pagination: result.pagination
        }, 'Purchase invoices retrieved successfully');
    } catch (error) {
        console.error('Error fetching purchase invoices:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Get single purchase invoice by ID
 */
const getInvoiceById = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const invoice = await PurchaseInvoiceModel.getById(workspaceId, invoiceId);

        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        return successResponse(res, invoice, 'Purchase invoice retrieved successfully');
    } catch (error) {
        console.error('Error fetching invoice:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Create new purchase invoice
 */
const createInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        // Validate required fields
        const requiredFields = ['gstin_id', 'invoice_number', 'invoice_date', 'posting_date',
            'supplier_gstin', 'supplier_name', 'place_of_supply_code',
            'source_system', 'taxable_value'];

        for (const field of requiredFields) {
            if (!invoiceData[field]) {
                return errorResponse(res, `Missing required field: ${field}`, 400);
            }
        }

        // Validate GSTIN format
        const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstinRegex.test(invoiceData.supplier_gstin)) {
            return errorResponse(res, 'Invalid supplier GSTIN format', 400);
        }

        // Set defaults
        invoiceData.source_system = invoiceData.source_system || 'MANUAL';
        invoiceData.payment_status = invoiceData.payment_status || 'UNPAID';

        const invoice = await PurchaseInvoiceModel.create(workspaceId, invoiceData);

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'CREATE_PURCHASE_INVOICE',
            entityType: 'PurchaseInvoice',
            entityId: invoice.id,
            details: { invoiceNumber: invoiceData.invoice_number },
            req
        });

        return successResponse(res, invoice, 'Purchase invoice created successfully', 201);
    } catch (error) {
        console.error('Error creating purchase invoice:', error);
        if (error.message.includes('duplicate') || error.code === '23505') {
            return errorResponse(res, 'Invoice with this number already exists', 409);
        }
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Update purchase invoice
 */
const updateInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;
        const updateData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const invoice = await PurchaseInvoiceModel.update(workspaceId, invoiceId, updateData);

        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'UPDATE_PURCHASE_INVOICE',
            entityType: 'PurchaseInvoice',
            entityId: invoice.id,
            details: { invoiceId },
            req
        });

        return successResponse(res, invoice, 'Purchase invoice updated successfully');
    } catch (error) {
        console.error('Error updating invoice:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Create invoice amendment
 */
const amendInvoice = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const invoiceId = req.params.id;
        const amendmentData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        // Check if invoice exists
        const invoice = await PurchaseInvoiceModel.getById(workspaceId, invoiceId);
        if (!invoice) {
            return errorResponse(res, 'Invoice not found', 404);
        }

        // Feature not implemented yet
        return errorResponse(res, 'Amendment feature not implemented', 501);
    } catch (error) {
        console.error('Error creating amendment:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Synchronise purchase vouchers from third-party platforms (Tally, Zoho) in Adesk format
 */
const syncThirdPartyPurchases = async (req, res) => {
    try {
        const knex = require('../../../shared/src/db/connection');
        const ConnectorImportModel = require('../connectors/connectorImportModel');

        // ─── Authentication: 3-tier system ───────────────────────────────────────
        // Tier 1 (recommended): x-api-key  — permanent API key from generate-api-key endpoint
        // Tier 2:               x-org-token — scoped JWT issued at login
        // Tier 3:               legacy headers (platform + organization-gstno) + Bearer JWT
        // ─────────────────────────────────────────────────────────────────────────

        const rawApiKey  = req.headers['x-api-key'];
        const rawOrgToken = req.headers['x-org-token'] || req.headers['org-token'];

        let workspace = null;
        let platform  = null;
        let resolvedUserId = null;

        if (rawApiKey) {
            // ── Tier 1: Permanent API Key ────────────────────────────────────────
            const keyRecord = await knex('third_party_api_keys')
                .where({ api_key: rawApiKey, is_active: true })
                .first();

            if (!keyRecord) {
                return errorResponse(res, 'Invalid or revoked API key', 401);
            }

            // Check expiry if set
            if (keyRecord.expires_at && new Date() > new Date(keyRecord.expires_at)) {
                return errorResponse(res, 'API key has expired. Please generate a new one.', 401);
            }

            workspace = await knex('workspaces')
                .where({ id: keyRecord.workspace_id })
                .first();

            if (!workspace) {
                return errorResponse(res, 'Workspace linked to this API key not found', 404);
            }

            platform       = keyRecord.platform || (req.headers['platform'] || req.headers['x-platform'] || 'API');
            resolvedUserId = keyRecord.user_id;

            // Update last_used_at (fire and forget)
            knex('third_party_api_keys')
                .where({ id: keyRecord.id })
                .update({ last_used_at: knex.fn.now() })
                .catch(() => {});

        } else if (rawOrgToken) {
            // ── Tier 2: Org-scoped JWT ───────────────────────────────────────────
            let orgClaims;
            try {
                const jwtSecret = process.env.JWT_SECRET || 'change-this-secret-in-production';
                orgClaims = jwt.verify(rawOrgToken, jwtSecret, { issuer: 'gst-recon-tool' });
            } catch (jwtErr) {
                return errorResponse(res, `Invalid or expired org_access_token: ${jwtErr.message}. Please login again.`, 401);
            }

            workspace = await knex('workspaces').where({ id: orgClaims.workspace_id }).first();
            if (!workspace) {
                return errorResponse(res, 'Workspace referenced in token not found', 404);
            }

            platform       = orgClaims.platform;
            resolvedUserId = orgClaims.user_id;

        } else {
            // ── Tier 3: Legacy headers (requires Bearer JWT) ─────────────────────
            platform       = req.headers['platform'] || req.headers['x-platform'];
            const orgGstNo = req.headers['organization-gstno'] || req.headers['x-organization-gstno'];

            if (!platform || !orgGstNo) {
                return errorResponse(
                    res,
                    'Authentication required. Provide one of: x-api-key header, x-org-token header, or platform + organization-gstno headers with Bearer JWT.',
                    400
                );
            }

            workspace = await knex('workspaces').where({ gstn: orgGstNo.trim().toUpperCase() }).first();
            if (!workspace) {
                return errorResponse(res, `Workspace with GSTIN ${orgGstNo} not found`, 404);
            }

            const user = req.user;
            if (!user) {
                return errorResponse(res, 'Bearer token required when using header-based auth', 401);
            }

            const isSuperAdmin = user.role === 'SUPER_ADMIN' || (user.groups && user.groups.includes('super-admin'));
            if (!isSuperAdmin) {
                const access = await knex('workspace_users')
                    .where({ workspace_id: workspace.id, user_id: user.db_id || user.id, invitation_status: 'ACTIVE' })
                    .whereNull('removed_at')
                    .first();
                if (!access) {
                    return errorResponse(res, 'Access denied for the specified workspace', 403);
                }
            }

            resolvedUserId = user.db_id || user.id;
        }
        // ─────────────────────────────────────────────────────────────────────────

        const user = req.user || { db_id: resolvedUserId, id: resolvedUserId, email: 'api-key-auth' };


        const rawVouchers = Array.isArray(req.body) ? req.body : (req.body.vouchers || []);
        if (rawVouchers.length === 0) {
            return successResponse(res, {
                records_received: 0,
                records_inserted: 0,
                records_skipped: 0
            }, 'No vouchers provided to sync');
        }

        const mappedDocs = [];
        for (const record of rawVouchers) {
            const vchrDate = record.supplier_invoice_date || record.vchr_date || null;
            
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

            const bookVchrNo = String(record.book_vchr_no || record.vchr_full_number || record.vchr_no || '').trim();
            const supplierInvoiceNo = String(
                record.supplier_invoice_no ||
                record.ref_vchr_full_number ||
                record.ref_vchr_no ||
                bookVchrNo
            ).trim();
            
            if (!supplierInvoiceNo) {
                continue;
            }

            const supplierGstin = String(record.supplier_gstin || record.party_gstn_no || '').trim().toUpperCase();
            const supplierName = String(record.supplier_name || record.party_name || 'Generic Supplier').trim();

            let bookType = (record.book_type || record.vchr_prefix || 'PA').trim().toUpperCase();
            let voucherType = (record.voucher_type || record.vchr_type || 'PURCHASE').trim().toUpperCase();

            if (voucherType === 'EXP' || voucherType === 'EXPENSE') {
                voucherType = 'EXPENSE';
                bookType = 'EXP';
            } else if (voucherType === 'PUR' || voucherType === 'PURCHASE' || voucherType === 'PA') {
                voucherType = 'PURCHASE';
                bookType = 'PA';
            } else if (voucherType === 'DN' || voucherType === 'DEBIT_NOTE') {
                voucherType = 'DEBIT_NOTE';
                bookType = 'DN';
            } else if (voucherType === 'CN' || voucherType === 'CREDIT_NOTE') {
                voucherType = 'CREDIT_NOTE';
                bookType = 'CN';
            } else {
                if (bookType.includes('EXP')) {
                    bookType = 'EXP';
                    voucherType = 'EXPENSE';
                } else if (bookType.includes('DN')) {
                    bookType = 'DN';
                    voucherType = 'DEBIT_NOTE';
                } else if (bookType.includes('CN')) {
                    bookType = 'CN';
                    voucherType = 'CREDIT_NOTE';
                } else {
                    bookType = 'PA';
                    voucherType = 'PURCHASE';
                }
            }

            const taxableTotal = parseFloat(record.taxable_value || record.taxable_amount || record.total_taxable_amount || 0);
            const netAmount = parseFloat(record.row_wise_total_amount || record.net_amount || record.total_value || record.invoice_amount || 0);
            const totalIgstAmount = parseFloat(record.igst || record.igst_amount || record.total_igst_tax_amount || 0);
            const totalCgstAmount = parseFloat(record.cgst || record.cgst_amount || record.total_cgst_tax_amount || 0);
            const totalSgstAmount = parseFloat(record.sgst || record.sgst_amount || record.total_sgst_tax_amount || 0);
            const totalCessAmount = parseFloat(record.cess || record.cess_amount || record.total_cess_tax_amount || 0);

            const header = {
                tenant_id: workspace.tenant_id,
                workspace_id: workspace.id,
                supplier_invoice_no: supplierInvoiceNo,
                supplier_invoice_date: vchrDate,
                book_vchr_no: bookVchrNo,
                book_vchr_date: record.book_vchr_date || vchrDate,
                supplier_name: supplierName,
                supplier_gstin: supplierGstin || null,
                taxable_total: taxableTotal,
                net_amount: netAmount,
                total_igst_amount: totalIgstAmount,
                total_cgst_amount: totalCgstAmount,
                total_sgst_amount: totalSgstAmount,
                total_cess_amount: totalCessAmount,
                round_off: parseFloat(record.round_off || record.round_off_amount || 0),
                discount: parseFloat(record.discount || 0),
                total_qty: parseFloat(record.total_qty || 0),
                place_of_supply: record.place_of_supply || record.party_state_id || null,
                is_interstate: record.is_interstate || (record.inter_state === 'Yes') || false,
                is_rcm: record.is_rcm || (record.reverse_charge === 'Yes') || false,
                voucher_type: voucherType,
                book_type: bookType,
                gstr_category: record.gstr_category || null,
                status: record.status || 'APPROVED',
                remarks: record.remarks || record.description || null,
                filing_period: returnPeriod,
                return_period: returnPeriod,
                t_extra_info: {
                    source: 'third_party_api_sync',
                    platform: platform,
                    original_data: record
                }
            };

            const items = [{
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
                row_total: netAmount,
                invoice_amount: netAmount,
                t_extra_info: '{}'
            }];

            mappedDocs.push({ header, items });
        }

        // Group mapped documents by invoice identity to combine split tax-rate lines
        const groupedMap = new Map();
        for (const doc of mappedDocs) {
            const header = doc.header;
            const key = `${header.book_vchr_no}__${header.book_vchr_date}`;
            if (!groupedMap.has(key)) {
                const headerClone = { ...header };
                headerClone.taxable_total = 0;
                headerClone.total_igst_amount = 0;
                headerClone.total_cgst_amount = 0;
                headerClone.total_sgst_amount = 0;
                headerClone.total_cess_amount = 0;
                headerClone.net_amount = 0;

                groupedMap.set(key, {
                    header: headerClone,
                    items: []
                });
            }
            const existing = groupedMap.get(key);
            existing.items.push(...doc.items);
            existing.header.taxable_total += header.taxable_total;
            existing.header.total_igst_amount += header.total_igst_amount;
            existing.header.total_cgst_amount += header.total_cgst_amount;
            existing.header.total_sgst_amount += header.total_sgst_amount;
            existing.header.total_cess_amount += header.total_cess_amount;
            existing.header.net_amount += header.net_amount;
            if (header.round_off !== 0) {
                existing.header.round_off = header.round_off;
            }
        }
        const groupedDocs = Array.from(groupedMap.values());
        for (const doc of groupedDocs) {
            if (!doc.header.net_amount || doc.header.net_amount <= 0) {
                doc.header.net_amount =
                    doc.header.taxable_total +
                    doc.header.total_igst_amount +
                    doc.header.total_cgst_amount +
                    doc.header.total_sgst_amount +
                    doc.header.total_cess_amount +
                    (doc.header.round_off || 0);
            }
            for (const k of ['taxable_total', 'total_igst_amount', 'total_cgst_amount', 'total_sgst_amount', 'total_cess_amount', 'net_amount']) {
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
            importType: 'PURCHASE_REGISTER',
            extraInfo: { source: 'third_party_sync', platform: platform, records_count: rawVouchers.length },
            userEmail: user.email || 'connector@third-party'
        });

        const result = await ConnectorImportModel.bulkInsertPurchase(groupedDocs, importRecord.import_filing_id);

        if (result.inserted === 0 && result.duplicateInvoices.length === 0) {
            await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Failed', 0, {
                reason: 'All records rejected as duplicates'
            });
            return errorResponse(res, 'All synchronised vouchers were already registered in the system (duplicates skipped)', 400);
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

        // Publish to NATS for asynchronous reconciliation run
        try {
            const { publishMessage } = require('../../../shared/src/nats/client');
            await publishMessage('book-data-imported', JSON.stringify({
                tenant_id: workspace.tenant_id,
                workspace_id: workspace.id,
                return_period: returnPeriod,
                import_type: 'api_connector_purchases'
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

        return successResponse(res, {
            records_received: rawVouchers.length,
            records_inserted: result.inserted,
            records_skipped: result.duplicateInvoices.length,
            return_period: returnPeriod
        }, 'Purchase data synchronized successfully and reconciliations fired');

    } catch (error) {
        console.error('Third-party purchase sync error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    getAllInvoices,
    getInvoiceById,
    createInvoice,
    updateInvoice,
    amendInvoice,
    syncThirdPartyPurchases
};
