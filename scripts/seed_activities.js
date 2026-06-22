
const knex = require('knex');
const config = require('../services/shared/knexfile');
const { v4: uuidv4 } = require('uuid');

const environment = process.env.NODE_ENV || 'development';
const db = knex(config[environment]);

async function seed() {
    try {
        console.log('Seeding activity logs...');

        // Get the first tenant
        const tenant = await db('tenants').first();
        if (!tenant) {
            console.error('No tenants found. Cannot seed.');
            process.exit(1);
        }

        const tenantId = tenant.id;
        console.log(`Seeding for tenant: ${tenantId}`);

        // Get some users
        const users = await db('users').where('tenant_id', tenantId).limit(2);
        const userId = users.length > 0 ? users[0].id : null;

        const activities = [
            {
                action_type: 'NOTICE_RECEIVED',
                entity_type: 'NOTICE',
                details: JSON.stringify({ description: 'TaxCorp Solutions: Scrutiny notice for GSTR-1 discrepancy in November 2024 filing', priority: 'HIGH', referenceId: 'GST-SCR-2024-001234' }),
                created_at: knex.raw("NOW() - INTERVAL '2 hours'")
            },
            {
                action_type: 'LIABILITY_DUE',
                entity_type: 'LIABILITY',
                details: JSON.stringify({ description: 'ABC Enterprises: GSTR-3B tax payment due in 5 days - ₹65,744', priority: 'MEDIUM', amount: 65744 }),
                created_at: knex.raw("NOW() - INTERVAL '1 day'")
            },
            {
                action_type: 'RECONCILIATION_ALERT',
                entity_type: 'RECON',
                details: JSON.stringify({ description: 'XYZ Trading: 8 mismatches found in purchase reconciliation requiring attention', priority: 'MEDIUM', amount_diff: 23456 }),
                created_at: knex.raw("NOW() - INTERVAL '2 days'")
            },
            {
                action_type: 'ITC_CREDIT_AVAILABLE',
                entity_type: 'CREDIT_LEDGER',
                details: JSON.stringify({ description: 'PQR Industries: New input tax credit of ₹45,678 available for utilization', priority: 'LOW' }),
                created_at: knex.raw("NOW() - INTERVAL '3 days'")
            },
            {
                action_type: 'USER_LOGIN',
                entity_type: 'USER',
                details: JSON.stringify({ description: 'User logged in from new device', priority: 'LOW' }),
                created_at: knex.raw("NOW() - INTERVAL '1 hour'")
            },
            {
                action_type: 'GSTR1_FILED',
                entity_type: 'COMPLIANCE',
                details: JSON.stringify({ description: 'GSTR-1 filed successfully for Oct 2024', priority: 'LOW' }),
                created_at: knex.raw("NOW() - INTERVAL '5 days'")
            }
        ];

        for (const act of activities) {
            await db('activity_logs').insert({
                id: uuidv4(),
                tenant_id: tenantId,
                user_id: userId,
                action_type: act.action_type,
                entity_type: act.entity_type,
                details: act.details,
                created_at: act.created_at
            });
        }

        console.log('Seeding complete.');
        process.exit(0);

    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();
