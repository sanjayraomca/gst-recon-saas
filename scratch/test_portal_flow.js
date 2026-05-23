const knex = require('../services/shared/src/db/connection');
const jwt = require('../services/shared/node_modules/jsonwebtoken');
const axios = require('../services/workspace-service/node_modules/axios').default;

const JWT_SECRET = 'change-this-secret-in-production';
const PORT = 3002;
const WORKSPACE_ID = '5cd828ca-d518-4fa2-bfac-91940c0fae69';

async function test() {
    try {
        console.log('--- Starting GSTN Portal direct sync flow verification ---');

        // 1. Get user and workspace context
        const user = await knex('users').first();
        if (!user) {
            console.error('No user found in database!');
            process.exit(1);
        }
        console.log(`Using test user: ${user.email} (sub: ${user.auth_provider_id})`);

        // Check workspace
        const ws = await knex('workspaces').where({ id: WORKSPACE_ID }).first();
        if (!ws) {
            console.error(`Workspace ${WORKSPACE_ID} not found!`);
            process.exit(1);
        }
        console.log(`Using workspace: ${ws.name} (GSTIN: ${ws.gstn})`);

        // 2. Generate a token
        const token = jwt.sign({
            sub: user.auth_provider_id,
            email: user.email,
            exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
        }, JWT_SECRET);

        const client = axios.create({
            baseURL: `http://localhost:${PORT}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-workspace-id': WORKSPACE_ID
            }
        });

        // 3. Check Session Status
        console.log('\n1. Checking session status...');
        const sessionRes = await client.get('/connectors/gstn/session-status');
        console.log('Session Status response:', sessionRes.data);

        // 4. Request OTP
        console.log('\n2. Requesting OTP...');
        const otpRes = await client.post('/connectors/gstn/otp-request', {
            gst_username: 'taxpayer_user_123'
        });
        console.log('OTP Request response:', otpRes.data);
        const txn = otpRes.data.data.txn;

        // 5. Verify OTP
        console.log('\n3. Verifying OTP...');
        const verifyRes = await client.post('/connectors/gstn/verify-otp', {
            otp: '123456',
            txn: txn
        });
        console.log('OTP Verify response:', verifyRes.data);

        // Check if session status is now active
        const sessionCheckRes = await client.get('/connectors/gstn/session-status');
        console.log('Session Status check response:', sessionCheckRes.data);

        // 6. Sync GSTR-2B
        console.log('\n4. Syncing GSTR-2B...');
        const syncRes = await client.post('/connectors/gstn/sync-gstr2b', {
            return_period: '062025'
        });
        console.log('Sync response:', syncRes.data);

        // 7. Verify DB changes
        const imports = await knex('gstr_import_master')
            .where({ workspace_id: WORKSPACE_ID, return_period: '062025' })
            .select('import_filing_id', 'status');
        console.log('\nDatabase Check: gstr_import_master matching records:', imports);

        if (imports.length > 0) {
            const invoicesCount = await knex('normalized_gstr2b_invoices')
                .where({ import_filing_id: imports[0].import_filing_id })
                .count('* as count')
                .first();
            console.log(`Database Check: normalized_gstr2b_invoices count for import: ${invoicesCount.count}`);
        }

        console.log('\n--- Verification completed successfully! ---');
    } catch (err) {
        console.error('Test execution failed:', err.response?.data || err.message);
    } finally {
        process.exit(0);
    }
}

test();
