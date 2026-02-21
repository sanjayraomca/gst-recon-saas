const fs = require('fs');

async function runTests() {
    const BASE_URL_TENANT = 'http://localhost:3001';
    const BASE_URL_WORKSPACE = 'http://localhost:3002';
    const BASE_URL_UPLOAD = 'http://localhost:3004';

    let tenantId, token, workspaceId;
    const uniqueId = Date.now();
    const tenantEmail = `admin_${uniqueId}@test.com`;
    const tenantPassword = 'Password123!';

    console.log('--- E2E API Testing Started ---');

    try {
        // 1. Tenant Signup
        console.log(`\n[1/7] Testing Tenant Signup API for ${tenantEmail}...`);
        let res = await fetch(`${BASE_URL_TENANT}/tenants/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: `Test Company ${uniqueId}`,
                email: tenantEmail,
                password: tenantPassword,
                phone: '1234567890'
            })
        });
        let data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        console.log('✅ Signup successful!');

        // 2. Tenant Login
        console.log(`\n[2/7] Testing Tenant Login API...`);
        res = await fetch(`${BASE_URL_TENANT}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: tenantEmail,
                password: tenantPassword
            })
        });
        data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        token = data.data.access_token;
        tenantId = data.data.tenant_id;
        console.log('✅ Login successful! Token retrieved.');

        // 3. Add Workspace (Organization)
        console.log(`\n[3/7] Testing Organization Addition API...`);
        res = await fetch(`${BASE_URL_WORKSPACE}/workspaces`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: `Org ${uniqueId}`,
                code: '27AAACW1234A1Z5',
                state: 'Maharashtra',
                pan: 'AAACW1234A',
                trade_name: 'Test Trade Name',
                legal_name: 'Test Legal Name'
            })
        });
        data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        workspaceId = data.data.id || data.data.workspace_id;
        let gstinId = data.data.gstin_id;
        console.log('✅ Organization added successfuly!');

        // 4. Add User under Tenant
        console.log(`\n[4/7] Testing User Addition API...`);
        res = await fetch(`${BASE_URL_TENANT}/tenants/${tenantId}/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                email: `user_${uniqueId}@test.com`,
                full_name: 'Test User',
                phone_number: '0987654321',
                role: 'Viewer',
                organization_ids: [workspaceId]
            })
        });
        data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        console.log('✅ User added successfuly!');

        // Helper for file uploads
        const uploadFile = async (url, filePath, fieldName = 'file', extraFields = {}) => {
            const fileName = filePath.split('/').pop();
            const fileBuffer = fs.readFileSync(filePath);
            const fileBlob = new Blob([fileBuffer]);

            const formData = new FormData();
            formData.append(fieldName, fileBlob, fileName);
            for (const [key, value] of Object.entries(extraFields)) {
                formData.append(key, value);
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            const d = await response.json();
            if (!response.ok) throw new Error(JSON.stringify(d));
            return d;
        };

        // 5. Book Data Import - Sales
        console.log(`\n[5/7] Testing Book Data Import API (Sales)...`);
        await uploadFile(`${BASE_URL_UPLOAD}/gst-import/book/sales/upload`, '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/upload-service/scripts/sales_register.xlsx', 'file', {
            workspace_id: workspaceId,
            return_period: '042025'
        });
        console.log('✅ Sales Book uploaded successfully!');

        // 6. Book Data Import - Purchase
        console.log(`\n[6/7] Testing Book Data Import API (Purchase)...`);
        await uploadFile(`${BASE_URL_UPLOAD}/gst-import/book/purchase/upload`, '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/upload-service/scripts/purchase_register.xlsx', 'file', {
            workspace_id: workspaceId,
            return_period: '042025'
        });
        console.log('✅ Purchase Book uploaded successfully!');

        // 7. Book Data Import - Invalid Sales (GSTIN Mismatch)
        console.log(`\n[7/8] Testing Invalid Book Data Import API (GSTIN Mismatch)...`);
        try {
            await uploadFile(`${BASE_URL_UPLOAD}/gst-import/book/sales/upload`, '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/upload-service/scripts/invalid_sales_register.xlsx', 'file', {
                workspace_id: workspaceId,
                return_period: '042025'
            });
            throw new Error("Expected upload to fail due to GSTIN mismatch, but it succeeded!");
        } catch (e) {
            const errStr = e.message;
            if (errStr.includes('GSTIN Mismatch')) {
                console.log('✅ Invalid Sales Book was correctly rejected (GSTIN Mismatch)!');
            } else {
                throw new Error(`Expected GSTIN Mismatch error, got: ${errStr}`);
            }
        }

        // 8. GSTR Data Import - GSTR-2B
        console.log(`\n[8/8] Testing GSTR Data Import API (GSTR-2B)...`);
        await uploadFile(`${BASE_URL_UPLOAD}/gst-import/import/upload`, '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/upload-service/scripts/purchase_register.xlsx', 'file', {
            workspace_id: workspaceId,
            gstin_id: gstinId,
            return_period: '042025',
            gstr_type: 'GSTR2B'
        });
        console.log('✅ GSTR Data uploaded successfully!');

        console.log('\n--- All E2E Tests Passed Successfully! ---');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

runTests();
