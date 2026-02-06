exports.up = function (knex) {
    return knex.schema
        // 1. gst_notices
        .createTableIfNotExists('gst_notices', function (table) {
            table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
            table.uuid('workspace_id').notNullable().index(); // FK will be checked by DB if workspaces exists
            table.uuid('gstin_id').notNullable();
            table.string('notice_number', 100).notNullable();
            table.string('notice_type', 50).notNullable(); // Check constraints difficult in knex, rely on service validation
            table.date('notice_date').notNullable();
            table.date('received_date').notNullable();
            table.date('due_date');
            table.string('issuing_authority', 200);
            table.string('jurisdiction', 100);
            table.decimal('demand_amount', 15, 2).defaultTo(0);
            table.decimal('interest_amount', 15, 2).defaultTo(0);
            table.decimal('penalty_amount', 15, 2).defaultTo(0);
            // total_payable is generated column, skipped in knex usually or use specific raw
            table.string('reason_code', 50);
            table.text('reason_description');
            table.string('sections_applicable', 500);
            table.string('periods_covered', 500);
            table.string('status', 20).notNullable().defaultTo('OPEN');
            table.date('response_due_date');
            table.date('response_submitted_date');
            table.string('response_arn', 100);
            table.uuid('notice_document_id');
            table.uuid('response_document_id');
            table.jsonb('supporting_documents');
            table.uuid('linked_recon_run_id');
            table.specificType('linked_invoice_ids', 'uuid[]');
            table.specificType('linked_period_ids', 'uuid[]');
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.uuid('created_by');
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            table.uuid('updated_by');

            table.unique(['workspace_id', 'notice_number']);
        })
        // 2. notice_defense_packs
        .createTableIfNotExists('notice_defense_packs', function (table) {
            table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
            table.uuid('notice_id').notNullable().references('id').inTable('gst_notices').onDelete('CASCADE');
            table.uuid('workspace_id').notNullable();
            table.string('defense_strategy', 50);
            table.text('legal_grounds');
            table.text('case_precedents');
            table.text('draft_reply');
            table.text('explanation_summary');
            table.jsonb('supporting_arguments');
            table.specificType('evidence_snapshot_ids', 'uuid[]');
            table.uuid('recon_snapshot_id');
            table.jsonb('document_references');
            table.string('generation_status', 20).defaultTo('DRAFT');
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.uuid('created_by');
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            table.uuid('reviewed_by');
            table.timestamp('reviewed_at');
        })
        // 3. vendor_communications
        .createTableIfNotExists('vendor_communications', function (table) {
            table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
            table.uuid('workspace_id').notNullable();
            table.string('supplier_gstin', 15);
            table.uuid('supplier_id');
            table.string('communication_type', 30).notNullable();
            table.string('direction', 10).notNullable();
            table.string('subject', 500);
            table.text('body');
            table.jsonb('attachments');
            table.specificType('related_invoice_ids', 'uuid[]');
            table.uuid('related_period_id');
            table.string('issue_type', 50);
            table.string('status', 20).defaultTo('SENT');
            table.boolean('requires_follow_up').defaultTo(false);
            table.date('follow_up_date');
            table.text('follow_up_notes');
            table.uuid('created_by');
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            table.timestamp('replied_at');
        });
};

exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('vendor_communications')
        .dropTableIfExists('notice_defense_packs')
        .dropTableIfExists('gst_notices');
};
