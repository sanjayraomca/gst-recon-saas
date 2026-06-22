/**
 * test_adesk_real_sync.js
 * 
 * Standalone script to demonstrate fetching real data from Adesk Cloud API
 * and importing it into the GST Reconciliation database.
 * 
 * Run: node test_adesk_real_sync.js
 */

require('dotenv').config({ path: './.env' });
const axios = require('axios');
const knex = require('../../shared/src/db/connection');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ADESK_URL   = 'https://cloak-devotedly-veal.ngrok-free.dev/finas1/v6/tig/v1/purchase';
const API_KEY     = 'tig_inbound_4nEYYmlAviMAf9oyoRYZJsXe7IgnNkWn';
const START_DATE  = '2025-04-01';
const END_DATE    = '2026-03-31';
const BOOK_TYPE   = 'all';
const ROWS_PER_PG = 999999;
const WORKSPACE_ID = '276e51ab-12da-404a-bac9-be1d675ca0d3';
// ──────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isValidGSTIN(gstin) {
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin);
}

async function fetchAllPages() {
    console.log('\n📡 STEP 1: Fetching data from Adesk Cloud API...');
    console.log(`   URL       : ${ADESK_URL}`);
    console.log(`   Date range: ${START_DATE} → ${END_DATE}`);
    console.log(`   Book type : ${BOOK_TYPE}`);
    console.log('');

    let allRecords = [];
    let page = 1;
    let totalPages = 1;

    do {
        process.stdout.write(`   Page ${page}/${totalPages}... `);
        const res = await axios.get(ADESK_URL, {
            params: { start_date: START_DATE, end_date: END_DATE, book_type: BOOK_TYPE, page, rows: ROWS_PER_PG },
            headers: { 'X-TIG-API-KEY': API_KEY, 'Accept': 'application/json' },
            timeout: 15000
        });

        const data = res.data;
        if (!data || data.success !== 1 || !Array.isArray(data.data)) {
            throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
        }

        allRecords = allRecords.concat(data.data);
        totalPages = data.pagination?.total_pages || 1;
        console.log(`✅ ${data.data.length} records (total so far: ${allRecords.length})`);
        page++;
    } while (page <= totalPages);

    return allRecords;
}

async function analyzeRecords(records) {
    console.log('\n📊 STEP 2: Analyzing records...');

    const byType = {};
    const byCategory = {};
    let withGstin = 0, withoutGstin = 0, invalidGstin = 0;

    for (const r of records) {
        // By voucher type
        const vt = r.vchr_type || 'UNKNOWN';
        byType[vt] = (byType[vt] || 0) + 1;

        // By GST category
        const cat = r.gstr_category || 'EMPTY';
        byCategory[cat] = (byCategory[cat] || 0) + 1;

        // GSTIN analysis
        const gstin = (r.party_gstn_no || '').trim().toUpperCase();
        if (!gstin) {
            withoutGstin++;
        } else if (!isValidGSTIN(gstin)) {
            invalidGstin++;
        } else {
            withGstin++;
        }
    }

    console.log(`\n   Total records   : ${records.length}`);
    console.log(`   ✅ Valid GSTIN   : ${withGstin}`);
    console.log(`   ⚠️  No GSTIN     : ${withoutGstin} (expenses/non-GST)`);
    console.log(`   ❌ Invalid GSTIN : ${invalidGstin}`);

    console.log('\n   By Voucher Type:');
    for (const [k, v] of Object.entries(byType)) console.log(`     ${k.padEnd(12)} : ${v}`);

    console.log('\n   By GST Category:');
    for (const [k, v] of Object.entries(byCategory)) console.log(`     ${k.padEnd(12)} : ${v}`);

    return { withGstin, withoutGstin, invalidGstin };
}

async function showSampleRecords(records) {
    console.log('\n📋 STEP 3: Sample records (first 3)...');
    for (const r of records.slice(0, 3)) {
        console.log(`\n   Voucher   : ${r.vchr_full_number} (${r.vchr_type})`);
        console.log(`   Date      : ${r.vchr_date}`);
        console.log(`   Party     : ${r.party_name}`);
        console.log(`   GSTIN     : ${r.party_gstn_no || '(none)'}`);
        console.log(`   Taxable   : ₹${parseFloat(r.total_taxable_amount).toLocaleString('en-IN')}`);
        console.log(`   IGST      : ₹${parseFloat(r.total_igst_tax_amount).toLocaleString('en-IN')}`);
        console.log(`   CGST      : ₹${parseFloat(r.total_cgst_tax_amount).toLocaleString('en-IN')}`);
        console.log(`   SGST      : ₹${parseFloat(r.total_sgst_tax_amount).toLocaleString('en-IN')}`);
        console.log(`   Total     : ₹${parseFloat(r.invoice_amount).toLocaleString('en-IN')}`);
        console.log(`   Category  : ${r.gstr_category || 'NONGST'}`);
    }
}

async function saveToDatabase(records) {
    console.log('\n💾 STEP 4: Importing into database...');

    // Get workspace info
    const workspace = await knex('workspaces')
        .where({ id: WORKSPACE_ID })
        .select('id', 'tenant_id', 'gstn', 'name')
        .first();

    if (!workspace) throw new Error(`Workspace ${WORKSPACE_ID} not found`);
    console.log(`   Workspace : ${workspace.name} (${workspace.gstn})`);

    const ConnectorImportModel = require('./connectors/connectorImportModel');
    const { mapPurchaseRecord } = (() => {
        // inline simplified mapper
        const getPeriod = d => { if (!d) return '042026'; const p = d.split('-'); return `${p[1]}${p[0]}`; };
        const validGSTIN = g => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g);
        return {
            mapPurchaseRecord: (record, tenantId, workspaceId) => {
                const vchrDate = record.vchr_date || null;
                const period = getPeriod(vchrDate);
                const supplierInvoiceNo = String(record.vchr_full_number || record.vchr_no || '').trim();
                const supplierGstin = String(record.party_gstn_no || '').trim().toUpperCase();
                const supplierName = String(record.party_name || 'Generic Supplier').trim();

                let voucherType = (record.vchr_type || 'PURCHASE').trim().toUpperCase();
                if (voucherType === 'PUR') voucherType = 'PURCHASE';
                else if (voucherType === 'EXP') voucherType = 'EXPENSE';
                else if (voucherType === 'DN')  voucherType = 'DEBIT_NOTE';
                else if (voucherType === 'CN')  voucherType = 'CREDIT_NOTE';

                let bookType = (record.vchr_prefix || 'PA').trim().toUpperCase();
                if (bookType === 'PUR' || bookType === 'PURCHASE') bookType = 'PA';
                else if (bookType === 'EXPENSE' || bookType === 'EXP') bookType = 'EXP';

                if (!supplierInvoiceNo) throw new Error('Missing voucher number');
                const isExpense = bookType === 'EXP' || voucherType === 'EXPENSE';
                if (!isExpense && !supplierGstin) throw new Error(`Missing GSTIN for ${supplierName}`);
                if (supplierGstin && !validGSTIN(supplierGstin)) throw new Error(`Invalid GSTIN: ${supplierGstin}`);

                const taxable = parseFloat(record.total_taxable_amount || 0);
                const net     = parseFloat(record.invoice_amount || 0);
                const igst    = parseFloat(record.total_igst_tax_amount || 0);
                const cgst    = parseFloat(record.total_cgst_tax_amount || 0);
                const sgst    = parseFloat(record.total_sgst_tax_amount || 0);
                const cess    = parseFloat(record.total_cess_tax_amount || 0);

                return {
                    header: {
                        tenant_id: tenantId, workspace_id: workspaceId,
                        supplier_invoice_no: supplierInvoiceNo, supplier_invoice_date: vchrDate,
                        book_vchr_no: supplierInvoiceNo, book_vchr_date: vchrDate,
                        supplier_name: supplierName, supplier_gstin: supplierGstin,
                        taxable_total: taxable, net_amount: net,
                        total_igst_amount: igst, total_cgst_amount: cgst,
                        total_sgst_amount: sgst, total_cess_amount: cess,
                        round_off: parseFloat(record.round_off_amount || 0),
                        discount: 0, total_qty: 0,
                        place_of_supply: null,
                        is_interstate: record.inter_state === 'Yes',
                        is_rcm: record.reverse_charge === 'Yes',
                        voucher_type: voucherType, book_type: bookType,
                        gstr_category: record.gstr_category || 'NONGST',
                        status: 'DRAFT', remarks: null,
                        filing_period: period, return_period: period, tax_period_id: null,
                        t_extra_info: { source: 'adesk_cloud_connector_test' }
                    },
                    items: [{
                        hsn_code: null, description: record.description || 'Voucher details',
                        quantity: 1, uom: 'NOS', unit_rate: taxable, taxable_amount: taxable,
                        tax_per: parseFloat(record.tax_per || 0),
                        igst_amount: igst, cgst_amount: cgst, sgst_amount: sgst, cess_amount: cess,
                        total_amount_with_tax: net, t_extra_info: {}
                    }]
                };
            }
        };
    })();

    const documents = [];
    let skipped = 0;
    for (const record of records) {
        try {
            documents.push(mapPurchaseRecord(record, workspace.tenant_id, workspace.id));
        } catch (e) {
            skipped++;
        }
    }
    console.log(`   Mapped    : ${documents.length} valid records`);
    console.log(`   Skipped   : ${skipped} (validation failures)`);

    // Create import log
    const importRecord = await ConnectorImportModel.createImportRecord({
        tenantUuid: workspace.tenant_id,
        workspaceId: workspace.id,
        returnPeriod: '042026',
        financialYear: '2025-2026',
        importType: 'PURCHASE_REGISTER',
        extraInfo: { source: 'adesk_cloud_connector_test', records_count: records.length },
        userEmail: 'test@adesk-sync'
    });

    const result = await ConnectorImportModel.bulkInsertPurchase(documents);

    await ConnectorImportModel.updateImportStatus(importRecord.import_filing_id, 'Completed', result.inserted, {
        added_invoices: result.addedInvoices,
        duplicate_invoices: result.duplicateInvoices,
        skipped_validation: skipped
    });

    return { documents: documents.length, skipped, inserted: result.inserted, duplicates: result.duplicateInvoices?.length || 0 };
}

async function verifyDatabase(stats) {
    console.log('\n🔍 STEP 5: Verifying database...');

    const count = await knex('purchase_vouchers').where({ workspace_id: WORKSPACE_ID }).count('id as n').first();
    const items = await knex('purchase_items').where({ workspace_id: WORKSPACE_ID }).count('id as n').first();
    const imports = await knex('gstr_import_master').where({ workspace_id: WORKSPACE_ID }).orderBy('upload_timestamp', 'desc').first();

    console.log(`   purchase_vouchers : ${count.n} rows`);
    console.log(`   purchase_items    : ${items.n} rows`);
    if (imports) {
        console.log(`   latest import     : ${imports.import_filing_id}`);
        console.log(`   import status     : ${imports.status}`);
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Adesk Cloud Connector — Real Data Import Test');
    console.log('═══════════════════════════════════════════════════════════');

    try {
        const records = await fetchAllPages();
        await analyzeRecords(records);
        await showSampleRecords(records);
        const stats = await saveToDatabase(records);
        await verifyDatabase(stats);

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('  ✅ IMPORT COMPLETE');
        console.log(`     Records from Adesk : ${records.length}`);
        console.log(`     Mapped & validated : ${stats.documents}`);
        console.log(`     Inserted to DB     : ${stats.inserted}`);
        console.log(`     Duplicates skipped : ${stats.duplicates}`);
        console.log(`     Validation skipped : ${stats.skipped}`);
        console.log('═══════════════════════════════════════════════════════════\n');
    } catch (err) {
        console.error('\n❌ ERROR:', err.message);
    } finally {
        await knex.destroy();
    }
}

main();
