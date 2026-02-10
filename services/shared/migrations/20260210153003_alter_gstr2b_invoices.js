exports.up = function (knex) {
    return knex.schema.table('gstr2b_invoices', function (table) {
        // Invoice details
        table.string('invoice_type', 50); // 'Regular', 'Debit Note', 'Credit Note'
        table.decimal('invoice_value', 15, 2); // Total invoice value
        table.string('reverse_charge', 1); // 'Y' or 'N'

        // Supplier filing information
        table.string('supplier_filing_period', 20); // 'Apr-Jun 2025'
        table.date('supplier_filing_date'); // When supplier filed

        // Tax details
        table.decimal('tax_rate_percentage', 5, 2); // 5%, 12%, 18%, 28%

        // Source information
        table.string('source_system', 50); // 'E-Invoice', 'GSTR-1', 'IFF', 'GSTR-5'

        // E-Invoice details
        table.string('irn', 100); // Invoice Reference Number
        table.date('irn_date'); // IRN generation date

        // Amendment tracking
        table.date('original_invoice_date'); // For amended invoices
        table.date('amendment_date'); // When amendment was made

        // Status flags
        table.boolean('is_reversal').defaultTo(false); // ITC reversal
        table.boolean('is_rejected').defaultTo(false); // Rejected by portal
        table.text('rejection_reason'); // Why rejected
    });
};

exports.down = function (knex) {
    return knex.schema.table('gstr2b_invoices', function (table) {
        table.dropColumn('invoice_type');
        table.dropColumn('invoice_value');
        table.dropColumn('reverse_charge');
        table.dropColumn('supplier_filing_period');
        table.dropColumn('supplier_filing_date');
        table.dropColumn('tax_rate_percentage');
        table.dropColumn('source_system');
        table.dropColumn('irn');
        table.dropColumn('irn_date');
        table.dropColumn('original_invoice_date');
        table.dropColumn('amendment_date');
        table.dropColumn('is_reversal');
        table.dropColumn('is_rejected');
        table.dropColumn('rejection_reason');
    });
};
