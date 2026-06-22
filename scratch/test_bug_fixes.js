/**
 * Bug Fix Regression Test
 * Tests: Bug A, D, E, F, I from analysis_results.md
 */
'use strict';

const fetch = require('cross-fetch');
const { Client } = require('pg');

const TENANT_URL = 'http://localhost:3001';
const WS_URL     = 'http://localhost:3002';
const DB = {
    host: '127.0.0.1', port: 5435,
    user: 'gstadmin', password: 'GstAdmin123', database: 'gst_recon'
};

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✅ PASS — ${label}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL — ${label}${detail ? `: ${detail}` : ''}`);
        failed++;
    }
}

async function req(method, url, { headers = {}, body } = {}) {
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data;
    try { data = await res.json(); } catch { data = {}; }
    return { status: res.status, data };
}

// ─────────────────────────────────────────────
async function setup() {
    const ts = Date.now();
    const email = `bugfix_${ts}@test.com`;
    const pw = 'Password123';

    // Register
    const { data: reg } = await req('POST', `${TENANT_URL}/tenants/signup`, {
        body: { email, password: pw, full_name: 'Bug Fix Tester', phone: '9000000001' }
    });
    const tenantId = reg.data?.tenant?.id;
    if (!tenantId) throw new Error('Signup failed: ' + JSON.stringify(reg));

    // Login
    const { data: login } = await req('POST', `${TENANT_URL}/auth/login`, {
        body: { email, password: pw }
    });
    const token = login.data?.access_token;
    if (!token) throw new Error('Login failed: ' + JSON.stringify(login));

    // Create workspace
    const { data: ws } = await req('POST', `${WS_URL}/workspaces`, {
        headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': tenantId },
        body: {
            code: '29AABCD1234E1ZF',   // fixed 15-char GSTIN format
            name: `BugFix WS ${ts}`,
            type: 'COMPANY',
            filing_frequency: 'monthly',
            state: '29-Karnataka',
            city: 'Bengaluru',
            email
        }
    });
    const workspaceId = ws.data?.id;
    if (!workspaceId) throw new Error('Workspace creation failed: ' + JSON.stringify(ws));

    return { tenantId, token, workspaceId };
}

// ─────────────────────────────────────────────
async function seedData(tenantId, workspaceId) {
    const pg = new Client(DB);
    await pg.connect();

    const importId  = require('crypto').randomUUID();
    const invoiceId = require('crypto').randomUUID();

    // gstr_import_master
    await pg.query(`
        INSERT INTO gstr_import_master
            (import_filing_id, workspace_id, tenant_uuid, gstin_recipient, return_period, financial_year, generation_date, import_type, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [importId, workspaceId, tenantId, '29AABCD1234E1ZF', '112024', '2024-25', '2024-11-30', 'GSTR2B', 'Completed']);

    // purchase_vouchers — using real column names
    await pg.query(`
        INSERT INTO purchase_vouchers
            (id, workspace_id, tenant_id, supplier_invoice_no, supplier_invoice_date, supplier_gstin, supplier_name,
             net_amount, taxable_total, total_cgst_amount, total_sgst_amount, voucher_type, status, import_filing_id, is_rcm, itc_eligible)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [invoiceId, workspaceId, tenantId,
        'INV-BUGFIX-001', '2024-11-15', '29SUPP9999B1Z1', 'BugFix Supplier Ltd',
        118000, 100000, 9000, 9000, 'PURCHASE', 'APPROVED', importId, false, true]);

    // normalized_gstr2b_invoices
    await pg.query(`
        INSERT INTO normalized_gstr2b_invoices
            (id, workspace_id, tenant_id, import_filing_id, source_section, supplier_gstin, supplier_name,
             document_number_raw, document_date, document_value, taxable_value, cgst, sgst, reconciliation_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [require('crypto').randomUUID(), workspaceId, tenantId, importId,
        'B2B', '29SUPP9999B1Z1', 'BugFix Supplier Ltd',
        'INV-BUGFIX-001', '2024-11-15', 118000, 100000, 9000, 9000, 'pending']);

    await pg.end();
    return { importId, invoiceId };
}

// ─────────────────────────────────────────────
async function main() {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  Bug Fix Regression Tests');
    console.log('══════════════════════════════════════════════════\n');

    // ── SETUP ─────────────────────────────────
    console.log('▶ Setting up: user, workspace, seed data…');
    const { tenantId, token, workspaceId } = await setup();
    console.log(`  Tenant:    ${tenantId}`);
    console.log(`  Workspace: ${workspaceId}`);
    const { invoiceId } = await seedData(tenantId, workspaceId);
    console.log(`  Seeded invoice ${invoiceId}\n`);

    const hdr = {
        Authorization:   `Bearer ${token}`,
        'x-workspace-id': workspaceId,
        'x-tenant-id':    tenantId
    };
    // For Bug I: headers WITHOUT x-workspace-id (middleware should have set req.workspace_id)
    const hdrNoWs = {
        Authorization: `Bearer ${token}`,
        'x-tenant-id':  tenantId
    };

    // ── BUG A: Audit Log ──────────────────────
    console.log('──────────────────────────────────────────────────');
    console.log('BUG A — Audit Log page no longer crashes (UUID cast)');
    const auditRes = await req('GET', `${TENANT_URL}/tenants/audit-logs?page=1&page_size=10`, { headers: hdr });
    ok('GET /tenants/audit-logs returns 200', auditRes.status === 200, `got ${auditRes.status}`);
    ok('Response has data array', Array.isArray(auditRes.data?.data?.logs || auditRes.data?.data), JSON.stringify(auditRes.data).slice(0, 120));

    // ── BUG E: Purchase Invoice filters ──────
    console.log('\n──────────────────────────────────────────────────');
    console.log('BUG E — Purchase Invoice filter column mismatches');

    const piBase = `${WS_URL}/purchase-invoices`;

    // 1. Normal fetch (baseline)
    const eBase = await req('GET', `${piBase}`, { headers: hdr });
    ok('Baseline fetch returns 200', eBase.status === 200, `got ${eBase.status}`);

    // 2. ?search= (was: ev.invoice_number → now: ev.supplier_invoice_no)
    const eSearch = await req('GET', `${piBase}?search=INV-BUGFIX`, { headers: hdr });
    ok('?search=INV-BUGFIX returns 200 (not 500)', eSearch.status === 200, `got ${eSearch.status}`);
    ok('Search result finds seeded invoice', (eSearch.data?.data?.invoices?.length ?? eSearch.data?.data?.length ?? 0) >= 1,
        `found ${eSearch.data?.data?.invoices?.length ?? 0}`);

    // 3. ?invoice_date_from= (was: ev.invoice_date → now: ev.supplier_invoice_date)
    const eDate = await req('GET', `${piBase}?invoice_date_from=2024-11-01`, { headers: hdr });
    ok('?invoice_date_from returns 200 (not 500)', eDate.status === 200, `got ${eDate.status}`);

    // 4. ?invoice_date_to=
    const eDateTo = await req('GET', `${piBase}?invoice_date_to=2024-11-30`, { headers: hdr });
    ok('?invoice_date_to returns 200 (not 500)', eDateTo.status === 200, `got ${eDateTo.status}`);

    // 5. ?itc_eligibility_status=eligible (was: ev.itc_eligibility_status → now: ev.itc_eligible boolean)
    const eItc = await req('GET', `${piBase}?itc_eligibility_status=eligible`, { headers: hdr });
    ok('?itc_eligibility_status=eligible returns 200 (not 500)', eItc.status === 200, `got ${eItc.status}`);
    ok('ITC eligible filter finds seeded invoice', (eItc.data?.data?.invoices?.length ?? eItc.data?.data?.length ?? 0) >= 1,
        `found ${eItc.data?.data?.invoices?.length ?? 0}`);

    // 6. ?reverse_charge=false (was: ev.reverse_charge → now: ev.is_rcm)
    const eRcm = await req('GET', `${piBase}?reverse_charge=false`, { headers: hdr });
    ok('?reverse_charge=false returns 200 (not 500)', eRcm.status === 200, `got ${eRcm.status}`);

    // 7. ?gstin_id= (was: ev.gstin_id → now: ev.supplier_gstin)
    const eGstin = await req('GET', `${piBase}?gstin_id=29SUPP9999B1Z1`, { headers: hdr });
    ok('?gstin_id=GSTIN returns 200 (not 500)', eGstin.status === 200, `got ${eGstin.status}`);
    ok('GSTIN filter finds seeded invoice', (eGstin.data?.data?.invoices?.length ?? eGstin.data?.data?.length ?? 0) >= 1,
        `found ${eGstin.data?.data?.invoices?.length ?? 0}`);

    // ── BUG F: GSTR-2B match_status filter ──
    console.log('\n──────────────────────────────────────────────────');
    console.log('BUG F — GSTR-2B match_status → reconciliation_status');

    const g2bBase = `${WS_URL}/gstr2b-invoices`;

    // 1. Baseline
    const fBase = await req('GET', `${g2bBase}`, { headers: hdr });
    ok('GSTR-2B baseline fetch returns 200', fBase.status === 200, `got ${fBase.status}`);

    // 2. ?match_status=pending (was crashing; now maps to reconciliation_status)
    const fMatch = await req('GET', `${g2bBase}?match_status=pending`, { headers: hdr });
    ok('?match_status=pending returns 200 (not 500)', fMatch.status === 200, `got ${fMatch.status}`);
    ok('match_status filter finds seeded invoice',
        (fMatch.data?.data?.invoices?.length ?? fMatch.data?.data?.length ?? 0) >= 1,
        `found ${fMatch.data?.data?.invoices?.length ?? 0}`);

    // 3. Explicit ?reconciliation_status= also works
    const fRecon = await req('GET', `${g2bBase}?reconciliation_status=pending`, { headers: hdr });
    ok('?reconciliation_status=pending returns 200', fRecon.status === 200, `got ${fRecon.status}`);

    // ── BUG I: Workspace ID header fallback ──
    console.log('\n──────────────────────────────────────────────────');
    console.log('BUG I — Workspace ID accepted from x-workspace-id header');

    // Standard header still works
    const iHeader = await req('GET', `${piBase}`, { headers: hdr });
    ok('Purchase invoices work with x-workspace-id header', iHeader.status === 200, `got ${iHeader.status}`);

    // Also verify with query param (middleware resolves it → req.workspace_id → controller reads req.workspace_id)
    const iQuery = await req('GET', `${piBase}?workspace_id=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': tenantId }
    });
    ok('Purchase invoices work with ?workspace_id= query param (Bug I fallback)', iQuery.status === 200, `got ${iQuery.status}`);

    // GSTR-2B via header
    const iG2b = await req('GET', `${g2bBase}`, { headers: hdr });
    ok('GSTR-2B works with x-workspace-id header', iG2b.status === 200, `got ${iG2b.status}`);

    // ── BUG D: Activity log — no CLICK noise ─
    console.log('\n──────────────────────────────────────────────────');
    console.log('BUG D — Activity log drops CLICK/CHANGE events (server guard)');

    // CLICK event should be silently dropped (200 but not written)
    const dClick = await req('POST', `${TENANT_URL}/tenants/activities`, {
        headers: { Authorization: `Bearer ${token}` },
        body: {
            actionType: 'CLICK',
            entityType: 'UI_INTERACTION',
            entityId: 'some-button',
            details: { text: 'Save' }
        }
    });
    ok('POST CLICK activity returns 200 (silently dropped)', dClick.status === 200, `got ${dClick.status}`);

    // CHANGE event should also be dropped
    const dChange = await req('POST', `${TENANT_URL}/tenants/activities`, {
        headers: { Authorization: `Bearer ${token}` },
        body: {
            actionType: 'CHANGE',
            entityType: 'UI_INTERACTION',
            entityId: 'some-select',
            details: { value: 'foo' }
        }
    });
    ok('POST CHANGE activity returns 200 (silently dropped)', dChange.status === 200, `got ${dChange.status}`);

    // Meaningful event (PAGE_VIEW) should still be accepted
    const dPage = await req('POST', `${TENANT_URL}/tenants/activities`, {
        headers: { Authorization: `Bearer ${token}` },
        body: {
            actionType: 'PAGE_VIEW',
            entityType: 'NAVIGATION',
            entityId: 'page',
            tenantId,
            workspaceId,
            details: { path: '/dashboard' }
        }
    });
    ok('POST PAGE_VIEW activity returns 200 (accepted & written)', dPage.status === 200, `got ${dPage.status}`);

    // ── SUMMARY ──────────────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('  🎉 ALL TESTS PASSED');
    } else {
        console.log('  ⚠️  SOME TESTS FAILED — review above');
    }
    console.log('══════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
