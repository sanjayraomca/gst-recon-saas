
const { v4: uuidv4 } = require('uuid');

exports.up = async function (knex) {
    // 1. gstr_2b_filing_master
    await knex.schema.createTable('gstr_2b_filing_master', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.string('gstin', 15).notNullable();
        table.string('return_period', 10).notNullable(); // Format: MMYYYY
        table.date('filing_date');
        table.string('status', 20).defaultTo('PENDING'); // PENDING, PROCESSED, ERROR
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.unique(['gstin', 'return_period']);
    });

    // 2. gstr_2b_b2b_invoices (Partitioned)
    // defined using knex.raw because knex doesn't fully support declarative partitioning syntax in createTable
    await knex.raw(`
        CREATE TABLE gstr_2b_b2b_invoices (
            id uuid DEFAULT uuid_generate_v4(),
            gstin_supplier VARCHAR(15) NOT NULL,
            trade_name VARCHAR(255),
            invoice_number VARCHAR(50) NOT NULL,
            invoice_type VARCHAR(20),
            invoice_date DATE,
            invoice_value DECIMAL(18,2),
            place_of_supply VARCHAR(50),
            reverse_charge VARCHAR(1),
            taxable_value DECIMAL(18,2),
            igst_amount DECIMAL(18,2),
            cgst_amount DECIMAL(18,2),
            sgst_amount DECIMAL(18,2),
            cess_amount DECIMAL(18,2),
            filing_period VARCHAR(10),
            filing_date DATE,
            itc_availability VARCHAR(3),
            unavailability_reason VARCHAR(255),
            source VARCHAR(20),
            irn VARCHAR(64),
            irn_date DATE,
            ims_action_status VARCHAR(50),
            remarks VARCHAR(500),
            itc_reduction_flag VARCHAR(3),
            itc_reduction_igst DECIMAL(18,2),
            itc_reduction_cgst DECIMAL(18,2),
            itc_reduction_sgst DECIMAL(18,2),
            itc_reduction_cess DECIMAL(18,2),
            gstin_id uuid REFERENCES gstin_master(id), -- Link to our internal master
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            return_period VARCHAR(10) NOT NULL, -- Partition Key
            PRIMARY KEY (id, return_period)
        ) PARTITION BY LIST (return_period);
    `);

    // Create initial partitions for current and next few months (Example)
    // In a real app, these should be created dynamically or via a cron job.
    // Creating for 12/2024 to 12/2025 as a start.
    const periods = ['122024', '012025', '022025', '032025', '042025', '052025', '062025', '072025', '082025', '092025', '102025', '112025', '122025'];
    for (const period of periods) {
        await knex.raw(`CREATE TABLE gstr_2b_b2b_${period} PARTITION OF gstr_2b_b2b_invoices FOR VALUES IN ('${period}')`);
    }

    // Indexes for B2B
    // We cannot create global unique index on partitioned table unless it includes partition key.
    // But we need efficient querying.
    await knex.raw(`CREATE INDEX idx_b2b_recon ON gstr_2b_b2b_invoices (gstin_supplier, invoice_number, invoice_date)`);
    await knex.raw(`CREATE INDEX idx_b2b_irn ON gstr_2b_b2b_invoices (irn)`);


    // 3. gstr_2b_cdnr (Partitioned)
    await knex.raw(`
        CREATE TABLE gstr_2b_cdnr (
            id uuid DEFAULT uuid_generate_v4(),
            gstin_supplier VARCHAR(15) NOT NULL,
            trade_name VARCHAR(255),
            note_number VARCHAR(50) NOT NULL,
            note_type VARCHAR(20), -- C or D
            note_date DATE,
            note_value DECIMAL(18,2),
            place_of_supply VARCHAR(50),
            reverse_charge VARCHAR(1),
            taxable_value DECIMAL(18,2),
            igst_amount DECIMAL(18,2),
            cgst_amount DECIMAL(18,2),
            sgst_amount DECIMAL(18,2),
            cess_amount DECIMAL(18,2),
            filing_period VARCHAR(10),
            filing_date DATE,
            itc_availability VARCHAR(3),
            unavailability_reason VARCHAR(255),
            ims_action_status VARCHAR(50),
            remarks VARCHAR(500),
            itc_reduction_flag VARCHAR(3),
            itc_reduction_igst DECIMAL(18,2),
            itc_reduction_cgst DECIMAL(18,2),
            itc_reduction_sgst DECIMAL(18,2),
            itc_reduction_cess DECIMAL(18,2),
            gstin_id uuid REFERENCES gstin_master(id),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            return_period VARCHAR(10) NOT NULL,
            PRIMARY KEY (id, return_period)
        ) PARTITION BY LIST (return_period);
    `);

    for (const period of periods) {
        await knex.raw(`CREATE TABLE gstr_2b_cdnr_${period} PARTITION OF gstr_2b_cdnr FOR VALUES IN ('${period}')`);
    }

    await knex.raw(`CREATE INDEX idx_cdnr_recon ON gstr_2b_cdnr (gstin_supplier, note_number, note_date)`);


    // 4. gstr_2b_b2ba_amendments
    await knex.schema.createTable('gstr_2b_b2ba_amendments', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.string('gstin_supplier', 15);
        table.string('original_invoice_number', 50);
        table.date('original_invoice_date');
        table.string('revised_invoice_number', 50); // Just storing relevant fields
        table.date('revised_invoice_date');
        table.uuid('gstin_id').references('id').inTable('gstin_master');
        table.string('return_period', 10);
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // 5. gstr_2b_impg (Import of Goods)
    await knex.schema.createTable('gstr_2b_impg', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.string('port_code', 10);
        table.string('boe_number', 50);
        table.date('boe_date');
        table.date('icegate_ref_date');
        table.decimal('taxable_value', 18, 2);
        table.decimal('igst_amount', 18, 2);
        table.decimal('cess_amount', 18, 2);
        table.uuid('gstin_id').references('id').inTable('gstin_master');
        table.string('return_period', 10);
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // 6. Audit Log
    await knex.schema.createTable('audit_log', function (table) {
        table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        table.string('table_name', 50);
        table.uuid('record_id'); // Can't FK nicely to partitioned tables
        table.string('action', 20); // UPDATE
        table.jsonb('old_value');
        table.jsonb('new_value');
        table.string('modified_by', 100).nullable();
        table.timestamp('modified_at').defaultTo(knex.fn.now());
    });

    // 7. Functions
    await knex.raw(`
        CREATE OR REPLACE FUNCTION clean_invoice_number(inv_num text) RETURNS text AS $$
        BEGIN
            -- Remove special chars, spaces, and leading zeros
            -- Simple regex: replace non-alphanumeric with empty, then trim leading zeros
            RETURN ltrim(regexp_replace(upper(inv_num), '[^A-Z0-9]', '', 'g'), '0');
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // 8. Views
    await knex.raw(`
        CREATE OR REPLACE VIEW view_reconciliation_source AS
        SELECT
            id,
            gstin_supplier,
            trade_name,
            invoice_number,
            invoice_date,
            taxable_value,
            (igst_amount + cgst_amount + sgst_amount + cess_amount) AS total_tax,
            'B2B' as doc_type,
            ims_action_status,
            itc_availability,
            filing_date,
            return_period,
            gstin_id
        FROM gstr_2b_b2b_invoices
        UNION ALL
        SELECT
            id,
            gstin_supplier,
            trade_name,
            note_number as invoice_number,
            note_date as invoice_date,
            taxable_value,
            (igst_amount + cgst_amount + sgst_amount + cess_amount) AS total_tax,
            'CDNR' as doc_type,
            ims_action_status,
            itc_availability,
            filing_date,
            return_period,
            gstin_id
        FROM gstr_2b_cdnr;
    `);

    // 9. Trigger Function for Audit
    await knex.raw(`
        CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
        DECLARE
            old_val jsonb;
            new_val jsonb;
        BEGIN
            IF (TG_OP = 'UPDATE') THEN
                old_val = to_jsonb(OLD);
                new_val = to_jsonb(NEW);
                INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, modified_at)
                VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', old_val, new_val, NOW());
                RETURN NEW;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    `);

    // Attach Trigger to B2B Invoices (Partitioned tables inherit triggers usually in PG 11+, checking ver)
    // Actually in PG, triggers must be defined on partitions or the parent.
    // On PG 13+, triggers on partitioned table are supported. Assuming PG 13+.
    await knex.raw(`
        CREATE TRIGGER audit_b2b_update
        AFTER UPDATE ON gstr_2b_b2b_invoices
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
    `);

    await knex.raw(`
        CREATE TRIGGER audit_cdnr_update
        AFTER UPDATE ON gstr_2b_cdnr
        FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
    `);
};

exports.down = async function (knex) {
    await knex.raw('DROP VIEW IF EXISTS view_reconciliation_source');
    await knex.raw('DROP TABLE IF EXISTS gstr_2b_b2b_invoices CASCADE'); // Cascades to partitions
    await knex.raw('DROP TABLE IF EXISTS gstr_2b_cdnr CASCADE');
    await knex.schema.dropTableIfExists('gstr_2b_b2ba_amendments');
    await knex.schema.dropTableIfExists('gstr_2b_impg');
    await knex.schema.dropTableIfExists('gstr_2b_filing_master');
    await knex.schema.dropTableIfExists('audit_log');
    await knex.raw('DROP FUNCTION IF EXISTS clean_invoice_number');
    await knex.raw('DROP FUNCTION IF EXISTS audit_trigger_func');
};
