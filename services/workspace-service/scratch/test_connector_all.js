const path = require('path');
const workspaceDir = '/home/tanvir/Desktop/gsttool_project/gst-recon-saas';
module.paths.push(path.join(workspaceDir, 'services/workspace-service/node_modules'));

// Load .env from workspace root
require('dotenv').config({ path: path.join(workspaceDir, '.env') });
process.env.DB_PASSWORD = process.env.POSTGRES_MAIN_PASSWORD;
process.env.DB_NAME = process.env.POSTGRES_MAIN_DB;
process.env.DB_USER = process.env.POSTGRES_MAIN_USER;
process.env.DB_PORT = 5435;

const knex = require(path.join(workspaceDir, 'services/shared/src/db/connection'));
const { mapPurchaseRecord, mapSalesRecord } = require(path.join(workspaceDir, 'services/workspace-service/src/connectors/adeskSyncController'));
const ConnectorImportModel = require(path.join(workspaceDir, 'services/workspace-service/src/connectors/connectorImportModel'));

async function verify() {
    try {
        console.log('Fetching a workspace and tenant to run tests...');
        const workspace = await knex('workspaces').first();
        if (!workspace) {
            console.error('No workspace found in the database!');
            return;
        }

        const tenantId = workspace.tenant_id;
        const workspaceId = workspace.id;
        const orgGstin = workspace.gstn || '29AABCD1234E1ZF'; // Fallback for test if workspace.gstn is missing
        console.log(`Using tenantId: ${tenantId}, workspaceId: ${workspaceId}, orgGstin: ${orgGstin}`);

        // Cleanup any leftovers first
        await knex('purchase_items').where('description', 'PLATFORM-TEST-ITEM').del();
        await knex('purchase_vouchers').where('supplier_invoice_no', 'TEST-PLAT-PURCHASE-123').del();
        await knex('sales_invoice_items').where('description', 'PLATFORM-TEST-ITEM').del();
        await knex('sales_invoices').where('invoice_number', 'TEST-PLAT-SALES-123').del();

        // 1. Create and Sync Purchase Voucher
        const dummyPurchase = {
            vchr_full_number: 'TEST-PLAT-PURCHASE-123',
            vchr_date: '2026-05-10',
            vchr_type: 'EXPENSE',
            vchr_prefix: 'EXP',
            party_gstn_no: '', // empty to test fallback
            party_name: 'Test Supplier',
            total_taxable_amount: 1000,
            invoice_amount: 1180,
            total_igst_tax_amount: 180,
            total_cgst_tax_amount: 0,
            total_sgst_tax_amount: 0,
            total_cess_tax_amount: 0,
            round_off_amount: 0,
            tax_per: 18,
            description: 'PLATFORM-TEST-ITEM',
            connector_ref: 'conn-ref-123'
        };

        const mappedPurchase = mapPurchaseRecord(dummyPurchase, tenantId, workspaceId, '052026', orgGstin);
        console.log('Mapped Purchase Header Platform:', mappedPurchase.header.platform);
        console.log('Mapped Purchase Header POS:', mappedPurchase.header.place_of_supply);

        const purchaseResult = await ConnectorImportModel.bulkInsertPurchase([mappedPurchase]);
        console.log(`Bulk insert purchase result: inserted ${purchaseResult.inserted}`);

        // Verify purchase in database
        const dbPurchases = await knex('purchase_vouchers')
            .where('supplier_invoice_no', 'TEST-PLAT-PURCHASE-123')
            .select('id', 'supplier_invoice_no', 'platform', 'place_of_supply');
        console.log('DB Purchase Vouchers retrieved:', dbPurchases);

        // 2. Create and Sync Sales Invoice
        const dummySales = {
            vchr_full_number: 'TEST-PLAT-SALES-123',
            vchr_date: '2026-05-10',
            vchr_type: 'SALES',
            vchr_prefix: 'SA',
            party_gstn_no: '27ADQPT4177J3ZT', // State code 27 (Maharashtra)
            party_name: 'Test Customer',
            total_taxable_amount: 2000,
            invoice_amount: 2360,
            total_igst_tax_amount: 360,
            total_cgst_tax_amount: 0,
            total_sgst_tax_amount: 0,
            total_cess_tax_amount: 0,
            round_off_amount: 0,
            tax_per: 18,
            description: 'PLATFORM-TEST-ITEM',
            connector_ref: 'conn-ref-456'
        };

        const mappedSales = mapSalesRecord(dummySales, tenantId, workspaceId, '052026', orgGstin);
        console.log('Mapped Sales Header Platform:', mappedSales.header.platform);
        console.log('Mapped Sales Header POS (derived from customer gstin):', mappedSales.header.place_of_supply);

        const salesResult = await ConnectorImportModel.bulkInsertSales([mappedSales]);
        console.log(`Bulk insert sales result: inserted ${salesResult.inserted}`);

        // Verify sales in database
        const dbSales = await knex('sales_invoices')
            .where('invoice_number', 'TEST-PLAT-SALES-123')
            .select('id', 'invoice_number', 'platform', 'place_of_supply');
        console.log('DB Sales Invoices retrieved:', dbSales);

        // Assertions
        const purchaseVoucherPlatformOk = dbPurchases[0].platform === 'Adesk Accounting';
        const purchaseVoucherPosOk = dbPurchases[0].place_of_supply === orgGstin.substring(0, 2);
        const salesInvoicePlatformOk = dbSales[0].platform === 'Adesk Accounting';
        const salesInvoicePosOk = dbSales[0].place_of_supply === '27';

        if (purchaseVoucherPlatformOk && purchaseVoucherPosOk && salesInvoicePlatformOk && salesInvoicePosOk) {
            console.log('\n✅ VERIFICATION SUCCESS: Platform ("Adesk Accounting") and derived POS fields correctly set in DB!');
        } else {
            console.error('\n❌ VERIFICATION FAILURE: Some fields were not set correctly.');
            console.error({
                purchaseVoucherPlatformOk,
                purchaseVoucherPosOk,
                salesInvoicePlatformOk,
                salesInvoicePosOk
            });
        }

        // Clean up
        console.log('Cleaning up test records...');
        await knex('purchase_items').where('description', 'PLATFORM-TEST-ITEM').del();
        await knex('purchase_vouchers').where('supplier_invoice_no', 'TEST-PLAT-PURCHASE-123').del();
        await knex('sales_invoice_items').where('description', 'PLATFORM-TEST-ITEM').del();
        await knex('sales_invoices').where('invoice_number', 'TEST-PLAT-SALES-123').del();
        console.log('Cleanup complete.');

    } catch (err) {
        console.error('Verification failed with error:', err);
    } finally {
        await knex.destroy();
    }
}

verify();
