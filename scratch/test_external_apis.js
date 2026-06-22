const http = require('http');

const API_KEY = '8936edc55f36411fa32bbaa23d5e413e';
const BASE_URL = 'http://localhost:3015';

const request = (method, path, data = null, headers = {}) => {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}${path}`;
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                ...headers
            }
        };

        const req = http.request(url, options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                let parsed = body;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {}
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
};

const runTests = async () => {
    console.log('=== STARTING EXTERNAL API SERVICE VERIFICATION ===\n');
    let failures = 0;

    const assert = (condition, msg, details = '') => {
        if (condition) {
            console.log(`  ✓ [PASS] ${msg}`);
        } else {
            console.log(`  ✗ [FAIL] ${msg}`);
            if (details) console.log(`           ${details}`);
            failures++;
        }
    };

    try {
        // Test 1: Health Check
        const health = await request('GET', '/health', null, { 'X-API-Key': '' });
        assert(health.statusCode === 200 && health.body.status === 'UP', 'Health Check', JSON.stringify(health.body));

        // Test 2: Unauthenticated Block
        const unauth = await request('GET', '/ext/gst/search?gstin=27AAGCB1286Q1Z4', null, { 'X-API-Key': '' });
        assert(unauth.statusCode === 401, 'Auth Block (Missing Key)', `Status: ${unauth.statusCode}`);

        // Test 3: Unauthorized Library Block (Using a mock key or unauthorized library)
        const unauthLib = await request('POST', '/ext/einvoice/irn', { gstin: '27AAGCB1286Q1Z4' }, {
            'X-API-Key': '822a4b5f5a094f88825b22014b830fda'
        });
        assert(unauthLib.statusCode === 403, 'Library Auth Block (403 Forbidden)', JSON.stringify(unauthLib.body));

        // Test 4: E-Invoice IRN Generation (Cache MISS)
        const docNum = 'INV-' + Date.now();
        const payload = {
            gstin: '27AAGCB1286Q1Z4',
            doc_number: docNum,
            doc_type: 'INV',
            doc_date: '2026-05-21',
            buyer_gstin: '27ABCDE1234F1Z5',
            buyer_name: 'Test Customer Ltd',
            taxable_value: 50000.00,
            total_invoice_value: 59000.00
        };
        const genIrn = await request('POST', '/ext/einvoice/irn', payload);
        assert(genIrn.statusCode === 200 && genIrn.headers['x-cache'] === 'MISS', 'E-Invoice IRN Generation (MISS)', JSON.stringify(genIrn.body));

        const irn = genIrn.body.irn;
        assert(!!irn, 'IRN generated and returned', `IRN: ${irn}`);

        if (irn) {
            // Test 5: E-Invoice IRN Generation (Cache HIT)
            const genIrnHit = await request('POST', '/ext/einvoice/irn', payload);
            assert(genIrnHit.statusCode === 200 && genIrnHit.headers['x-cache'] === 'HIT', 'E-Invoice IRN Caching (HIT)', `X-Cache: ${genIrnHit.headers['x-cache']}`);

            // Test 6: Fetch E-Invoice IRN Details (Cache HIT)
            const getIrn = await request('GET', `/ext/einvoice/irn/${irn}`);
            assert(getIrn.statusCode === 200 && getIrn.body.data.irn === irn, 'Fetch IRN Details (HIT)', JSON.stringify(getIrn.body));

            // Test 7: Cancel E-Invoice
            const cancelIrn = await request('POST', '/ext/einvoice/irn/cancel', { irn, cancel_reason: 'Duplicate Entry' });
            assert(cancelIrn.statusCode === 200 && cancelIrn.body.success === true, 'Cancel E-Invoice', JSON.stringify(cancelIrn.body));

            // Test 8: Fetch Cancelled E-Invoice Details (Cache HIT showing CANCELLED status)
            const getCancelledIrn = await request('GET', `/ext/einvoice/irn/${irn}`);
            assert(getCancelledIrn.statusCode === 200 && getCancelledIrn.body.data.status === 'CANCELLED', 'Verify Cancelled Status', JSON.stringify(getCancelledIrn.body));
        }

        // Test 9: Get E-Invoice HSN Summary (Cache MISS)
        const randRetPeriod = '05' + (Math.floor(1000 + Math.random() * 9000));
        const hsnMiss = await request('GET', `/ext/einvoice/hsnsum?gstin=27AAGCB1286Q1Z4&ret_period=${randRetPeriod}`);
        assert(hsnMiss.statusCode === 200 && hsnMiss.headers['x-cache'] === 'MISS', 'Get E-Invoice HSN Summary (MISS)', JSON.stringify(hsnMiss.body));

        // Test 10: Get E-Invoice HSN Summary (Cache HIT)
        const hsnHit = await request('GET', `/ext/einvoice/hsnsum?gstin=27AAGCB1286Q1Z4&ret_period=${randRetPeriod}`);
        assert(hsnHit.statusCode === 200 && hsnHit.headers['x-cache'] === 'HIT', 'Get E-Invoice HSN Summary (HIT)', `X-Cache: ${hsnHit.headers['x-cache']}`);

        // Test 11: Generate E-Way Bill (Cache MISS)
        const ewbDocNum = 'DOC-EWB-' + Date.now();
        const ewbPayload = {
            gstin: '27AAGCB1286Q1Z4',
            doc_number: ewbDocNum,
            doc_type: 'INV',
            doc_date: '2026-05-21',
            consignee_gstin: '27ABCDE1234F1Z5',
            consignee_name: 'Test Consignee',
            total_value: 120000.00,
            trans_mode: '1',
            trans_distance: 250,
            vehicle_number: 'MH-12-PQ-1234'
        };
        const genEwb = await request('POST', '/ext/ewaybill', ewbPayload);
        assert(genEwb.statusCode === 200 && genEwb.headers['x-cache'] === 'MISS', 'Generate E-Way Bill (MISS)', JSON.stringify(genEwb.body));

        const ewbNo = genEwb.body.ewaybill_number;
        assert(!!ewbNo, 'E-Way Bill number returned', `EWB: ${ewbNo}`);

        if (ewbNo) {
            // Test 12: Fetch E-Way Bill Details (Cache HIT)
            const getEwb = await request('GET', `/ext/ewaybill/${ewbNo}`);
            assert(getEwb.statusCode === 200 && getEwb.headers['x-cache'] === 'HIT' && getEwb.body.data.vehicle_number === 'MH-12-PQ-1234', 'Fetch E-Way Bill Details (HIT)', JSON.stringify(getEwb.body));

            // Test 13: Update Vehicle (Part B update)
            const updateVeh = await request('POST', '/ext/ewaybill/vehicle', {
                ewaybill_number: ewbNo,
                vehicle_number: 'MH-12-RS-5678',
                from_place: 'Pune Depot',
                from_state: '27',
                update_reason: 2
            });
            assert(updateVeh.statusCode === 200 && updateVeh.body.success === true, 'Update E-Way Bill Vehicle (Part B)', JSON.stringify(updateVeh.body));

            // Test 14: Fetch E-Way Bill Details and check updated vehicle
            const getUpdatedEwb = await request('GET', `/ext/ewaybill/${ewbNo}`);
            assert(getUpdatedEwb.statusCode === 200 && getUpdatedEwb.body.data.vehicle_number === 'MH-12-RS-5678', 'Verify Vehicle Updated in E-Way Bill', JSON.stringify(getUpdatedEwb.body));

            // Test 15: Cancel E-Way Bill
            const cancelEwb = await request('POST', '/ext/ewaybill/cancel', { ewaybill_number: ewbNo, cancel_reason: 1 });
            assert(cancelEwb.statusCode === 200 && cancelEwb.body.success === true, 'Cancel E-Way Bill', JSON.stringify(cancelEwb.body));

            // Test 16: Verify status is CANCELLED
            const getCancelledEwb = await request('GET', `/ext/ewaybill/${ewbNo}`);
            assert(getCancelledEwb.statusCode === 200 && getCancelledEwb.body.data.status === 'CANCELLED', 'Verify E-Way Bill Status is CANCELLED', JSON.stringify(getCancelledEwb.body));
        }

    } catch (e) {
        console.error('Test run error:', e);
        failures++;
    }

    console.log('\n=== TESTING COMPLETED ===');
    if (failures === 0) {
        console.log('Status: ALL TESTS PASSED SUCCESSFULLY! ✓');
    } else {
        console.log(`Status: ${failures} TESTS FAILED! ✗`);
        process.exit(1);
    }
};

runTests();
