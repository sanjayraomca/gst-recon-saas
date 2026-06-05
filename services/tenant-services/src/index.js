require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNats } = require('../../shared/src/nats/client'); // Relative path to shared
const authRoutes = require('./routes/authRoutes');
const tenantRoutes = require('./routes/tenantRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'Tenant Service is running' });
});

// Start Server
const start = async () => {
    try {
        await connectNats();

        // Ensure third_party_users table exists
        const knex = require('../../shared/src/db/connection');
        try {
            await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            const hasTable = await knex.schema.hasTable('third_party_users');
            if (!hasTable) {
                await knex.schema.createTable('third_party_users', (table) => {
                    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
                    table.string('email', 255).unique().notNullable();
                    table.string('platform', 100).notNullable();
                    table.timestamp('last_login_at').defaultTo(knex.fn.now());
                    table.timestamps(true, true);
                });
                console.log('✅ Created table third_party_users');
            } else {
                console.log('✅ Table third_party_users verified');
            }
        } catch (dbErr) {
            console.error('❌ Failed to verify/create third_party_users table:', dbErr.message);
        }

        try {
            const hasActivityType = await knex.schema.hasColumn('activity_logs', 'activity_type');
            if (!hasActivityType) {
                await knex.schema.table('activity_logs', (table) => {
                    table.string('activity_type', 100).nullable();
                });
                console.log('✅ Added column activity_type to activity_logs table');
            } else {
                console.log('✅ Column activity_type in activity_logs verified');
            }
        } catch (dbErr) {
            console.error('❌ Failed to verify/alter activity_logs table:', dbErr.message);
        }
        // Ensure third_party_api_keys table exists
        try {
            const hasApiKeysTable = await knex.schema.hasTable('third_party_api_keys');
            if (!hasApiKeysTable) {
                await knex.schema.createTable('third_party_api_keys', (table) => {
                    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
                    table.string('api_key', 64).unique().notNullable();
                    table.string('key_name', 255).notNullable().defaultTo('Default Key');
                    table.uuid('user_id').notNullable();
                    table.uuid('workspace_id').notNullable();
                    table.uuid('tenant_id').notNullable();
                    table.string('platform', 100).nullable();
                    table.boolean('is_active').defaultTo(true);
                    table.timestamp('last_used_at').nullable();
                    table.timestamp('expires_at').nullable();
                    table.timestamps(true, true);
                });
                console.log('✅ Created table third_party_api_keys');
            } else {
                console.log('✅ Table third_party_api_keys verified');
            }
        } catch (dbErr) {
            console.error('❌ Failed to verify/create third_party_api_keys table:', dbErr.message);
        }

        const { setupGstinEventSubscriber } = require('./events/gstinEventHandler');
        setupGstinEventSubscriber();

        app.listen(PORT, () => {
            console.log(`Tenant Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Tenant Service:', error);
        process.exit(1);
    }
};

start();
