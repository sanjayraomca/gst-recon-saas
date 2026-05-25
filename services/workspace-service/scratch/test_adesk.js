const { mockAdeskServer } = require('../src/connectors/adeskSyncController');

const runTest = async (label, tenantUuid, orgUuid, orgGstn, type = 'purchase') => {
    console.log(`\n--- Test Case: ${label} ---`);
    const rawKey = `${tenantUuid}@@${orgUuid}@@${orgGstn}`;
    const encodedKey = Buffer.from(rawKey).toString('base64');

    const req = {
        headers: {
            'api_key': encodedKey
        },
        body: {
            type,
            start_date: '2026-04-01',
            end_date: '2026-04-30'
        }
    };

    let responseStatus = 200;
    let responseData = null;

    const res = {
        status: (code) => {
            responseStatus = code;
            return res;
        },
        json: (data) => {
            responseData = data;
            return res;
        }
    };

    await mockAdeskServer(req, res);

    console.log("Response Status Code:", responseStatus);
    console.log("Response Success State:", responseData?.success);
    console.log("Response Message:", responseData?.message);
    if (responseData?.status) {
        console.log("Response Operational Status:", responseData.status);
    }
};

const runAllTests = async () => {
    // 1. Success path
    await runTest(
        "Valid API Key (Purchase Sync)",
        "a0e7f7bb-c12b-42fa-a6e5-429949666ca0",
        "28ce58a7-3f22-4f95-9a7d-aa6546e9a84a",
        "27ABCDE1234F1Z1"
    );

    // 2. Success path: Ping Connection Test
    await runTest(
        "Connection Ping Check",
        "a0e7f7bb-c12b-42fa-a6e5-429949666ca0",
        "28ce58a7-3f22-4f95-9a7d-aa6546e9a84a",
        "27ABCDE1234F1Z1",
        "ping"
    );

    // 3. Failure: Invalid UUID
    await runTest(
        "Invalid Tenant UUID Format",
        "invalid-uuid-1234",
        "28ce58a7-3f22-4f95-9a7d-aa6546e9a84a",
        "27ABCDE1234F1Z1"
    );

    // 4. Failure: Invalid GSTIN
    await runTest(
        "Invalid GSTIN Format",
        "a0e7f7bb-c12b-42fa-a6e5-429949666ca0",
        "28ce58a7-3f22-4f95-9a7d-aa6546e9a84a",
        "12345GSTIN"
    );
};

runAllTests();
