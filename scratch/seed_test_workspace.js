const { Client } = require('pg');
require('dotenv').config({ path: '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/.env' });

const dbConfig = {
    host: '127.0.0.1',
    port: 5435, // Host mapped port
    database: process.env.POSTGRES_MAIN_DB || 'gst_recon',
    user: process.env.POSTGRES_MAIN_USER || 'gstadmin',
    password: process.env.POSTGRES_MAIN_PASSWORD || 'GstAdmin123',
};

async function main() {
    console.log('🌱 Seeding test workspace and tenant in postgres-main...');
    const client = new Client(dbConfig);
    await client.connect();

    try {
        const tenantId = 'beb799a7-adb9-4495-b322-935d847f238d';
        const workspaceId = '5cd828ca-d518-4fa2-bfac-91940c0fae69';
        const email = 'superadmin.dev@gmail.com';

        // 1. Seed Tenant
        await client.query(`
            INSERT INTO tenants (id, tenant_code, legal_name, subscription_plan, subscription_status)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_code) DO NOTHING
        `, [tenantId, 'TEST_TENANT', 'Test Corporate Ltd', 'ENTERPRISE', 'ACTIVE']);
        console.log('✅ Seeded Tenant.');

        // 2. Seed Workspace
        await client.query(`
            INSERT INTO workspaces (id, tenant_id, workspace_code, name, gstn, workspace_type, compliance_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tenant_id, workspace_code) DO NOTHING
        `, [workspaceId, tenantId, 'TEST_WS', 'Test Production Unit', '27AAGCB1286Q1Z4', 'COMPANY', 'STANDARD']);
        console.log('✅ Seeded Workspace.');

        // 3. Find User
        const userRes = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            console.error(`❌ User with email ${email} not found! Run seed-superadmin.js first.`);
            return;
        }
        const userId = userRes.rows[0].id;

        // 4. Update user's tenant association
        await client.query('UPDATE users SET tenant_id = $1 WHERE id = $2', [tenantId, userId]);
        console.log('✅ Associated test user with tenant.');

        // 5. Link user to workspace in workspace_users
        await client.query(`
            INSERT INTO workspace_users (workspace_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
        `, [workspaceId, userId, 'SUPER_ADMIN']);
        console.log('✅ Linked test user to workspace as SUPER_ADMIN.');

        console.log('🎉 Seeding complete successfully!');
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
    } finally {
        await client.end();
    }
}

main();
