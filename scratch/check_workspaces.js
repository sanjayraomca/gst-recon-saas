const knex = require('../services/shared/src/db/connection');

async function check() {
    try {
        const vouchers = await knex('purchase_vouchers')
            .where({ workspace_id: '5cd828ca-d518-4fa2-bfac-91940c0fae69' })
            .select('id', 'supplier_invoice_no', 'supplier_invoice_date', 'supplier_gstin', 'taxable_total', 'total_igst_amount', 'total_cgst_amount', 'total_sgst_amount', 'net_amount');
        console.log('Purchase Vouchers:');
        console.log(JSON.stringify(vouchers, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

check();
