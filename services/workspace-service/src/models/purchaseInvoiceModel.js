const knex = require('../../../shared/src/db/connection');
const crypto = require('crypto');

/**
 * Purchase Invoice Model
 * Matches purchase_vouchers table schema exactly
 */
class PurchaseInvoiceModel {
    /**
     * Get all purchase invoices with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            gstin_id,
            supplier_id,
            invoice_date_from,
            invoice_date_to,
            itc_eligibility_status,
            reverse_charge,
            payment_status,
            search
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = knex('purchase_vouchers as ev')
            .leftJoin('purchase_items as pi', 'ev.id', 'pi.purchase_id')
            .where('ev.workspace_id', workspaceId);

        // Apply filters
        if (gstin_id) query = query.where('ev.gstin_id', gstin_id);
        if (supplier_id) query = query.where('ev.supplier_id', supplier_id);
        if (invoice_date_from) query = query.where('ev.invoice_date', '>=', invoice_date_from);
        if (invoice_date_to) query = query.where('ev.invoice_date', '<=', invoice_date_to);
        if (itc_eligibility_status) query = query.where('ev.itc_eligibility_status', itc_eligibility_status);
        if (reverse_charge !== undefined) query = query.where('ev.reverse_charge', reverse_charge);
        if (payment_status) query = query.where('ev.payment_status', payment_status);
        if (search) {
            query = query.where('ev.invoice_number', 'like', `%${search}%`);
        }

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results — explicit columns only (avoids fetching t_extra_info JSONB + amendment blobs on every row)
        const invoices = await query
            .select(
                // Core identity
                'ev.id',
                'ev.workspace_id',
                'ev.tenant_id',
                'ev.import_filing_id',
                'ev.tax_period_id',
                // Supplier info
                'ev.supplier_name',
                'ev.supplier_gstin',
                'ev.supplier_id',
                // Invoice identity
                'ev.supplier_invoice_no',
                'ev.supplier_invoice_date',
                'ev.book_vchr_no',
                'ev.book_vchr_date',
                // Classification
                'ev.voucher_type',
                'ev.book_type',
                'ev.source_section',
                'ev.gstr_category',
                'ev.platform',
                'ev.status',
                'ev.is_deleted',
                // Financial totals
                'ev.taxable_total',
                'ev.net_amount',
                'ev.total_igst_amount',
                'ev.total_cgst_amount',
                'ev.total_sgst_amount',
                'ev.total_cess_amount',
                'ev.round_off',
                'ev.discount',
                // GST fields
                'ev.place_of_supply',
                'ev.is_interstate',
                'ev.is_rcm',
                'ev.return_period',
                'ev.filing_period',
                // ITC tracking
                'ev.itc_eligible',
                'ev.itc_claimed',
                // Payment
                'ev.payment_status',
                'ev.amount_paid',
                // Audit
                'ev.created_at',
                'ev.updated_at',
                // Line item columns from purchase_items join
                'pi.id as item_id',
                'pi.taxable_amount as item_taxable_amount',
                'pi.tax_per as item_tax_per',
                'pi.igst_amount as item_igst_amount',
                'pi.cgst_amount as item_cgst_amount',
                'pi.sgst_amount as item_sgst_amount',
                'pi.cess_amount as item_cess_amount',
                'pi.row_total as item_total_amount_with_tax',
                'pi.row_total as row_total',
                'pi.invoice_amount as item_invoice_amount',
                'pi.description as item_description'
            )
            .orderBy('ev.supplier_invoice_date', 'desc')
            .limit(page_size)
            .offset(offset);

        return {
            data: invoices,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single purchase invoice by ID
     */
    static async getById(workspaceId, invoiceId) {
        const voucher = await knex('purchase_vouchers')
            .where({
                id: invoiceId,
                workspace_id: workspaceId
            })
            .first();

        if (!voucher) return null;

        const items = await knex('purchase_items')
            .where('purchase_id', invoiceId)
            .orderBy('id', 'asc');

        voucher.items = items;
        return voucher;
    }

    /**
     * Create new purchase invoice
     */
    static async create(workspaceId, invoiceData) {
        // Generate raw_data_hash (required field)
        const hash = crypto.createHash('sha256')
            .update(JSON.stringify(invoiceData))
            .digest('hex');

        const [invoice] = await knex('purchase_vouchers')
            .insert({
                id: knex.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                gstin_id: invoiceData.gstin_id,
                supplier_id: invoiceData.supplier_id,
                invoice_number: invoiceData.invoice_number,
                invoice_date: invoiceData.invoice_date,
                posting_date: invoiceData.posting_date,
                invoice_type: invoiceData.invoice_type,
                supplier_gstin: invoiceData.supplier_gstin,
                supplier_name: invoiceData.supplier_name,
                supplier_state_code: invoiceData.supplier_state_code,
                taxable_value: invoiceData.taxable_value,
                cgst_amount: invoiceData.cgst_amount || 0,
                sgst_amount: invoiceData.sgst_amount || 0,
                igst_amount: invoiceData.igst_amount || 0,
                cess_amount: invoiceData.cess_amount || 0,
                place_of_supply_code: invoiceData.place_of_supply_code,
                supply_type: invoiceData.supply_type || 'B2B',
                reverse_charge: invoiceData.reverse_charge || false,
                ecommerce_gstin: invoiceData.ecommerce_gstin,
                hsn_sac_code: invoiceData.hsn_sac_code,
                hsn_sac_description: invoiceData.hsn_sac_description,
                item_description: invoiceData.item_description,
                quantity: invoiceData.quantity,
                unit_price: invoiceData.unit_price,
                discount_amount: invoiceData.discount_amount || 0,
                itc_eligibility_status: invoiceData.itc_eligibility_status || 'ELIGIBLE',
                itc_claimed: invoiceData.itc_claimed || false,
                payment_status: invoiceData.payment_status || 'UNPAID',
                payment_date: invoiceData.payment_date,
                payment_amount: invoiceData.payment_amount,
                source_system: invoiceData.source_system || 'MANUAL',
                source_file_id: invoiceData.source_file_id,
                raw_data_hash: hash,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            })
            .returning('*');

        return invoice;
    }

    /**
     * Update purchase invoice (limited fields)
     */
    static async update(workspaceId, invoiceId, updateData) {
        // Only allow updating specific fields
        const allowedFields = [
            'payment_status',
            'payment_date',
            'payment_amount',
            'itc_eligibility_status',
            'notes'
        ];

        const filteredData = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredData[key] = updateData[key];
            }
        });

        filteredData.updated_at = knex.fn.now();

        const [invoice] = await knex('purchase_vouchers')
            .where({
                id: invoiceId,
                workspace_id: workspaceId
            })
            .update(filteredData)
            .returning('*');

        return invoice;
    }
}

module.exports = PurchaseInvoiceModel;
