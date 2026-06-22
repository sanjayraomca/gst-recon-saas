const { Client } = require('pg');

async function test() {
  const client = new Client({
    user: 'gstadmin',
    password: 'GstAdmin123',
    host: 'localhost',
    port: 5435,
    database: 'gst_recon'
  });

  await client.connect();

  console.log('--- Checking purchase_vouchers with invoice date in April 2025 ---');
  const pvRes = await client.query(`
    SELECT book_vchr_no, supplier_invoice_no, supplier_name, supplier_invoice_date, return_period, taxable_total
    FROM purchase_vouchers
    WHERE supplier_invoice_date >= '2025-04-01' AND supplier_invoice_date <= '2025-04-30'
  `);
  console.log(`Total purchase_vouchers in April 2025: ${pvRes.rows.length}`);
  pvRes.rows.forEach(r => {
    console.log(`- VchrNo: ${r.book_vchr_no}, InvNo: ${r.supplier_invoice_no}, Date: ${r.supplier_invoice_date}, ReturnPeriod: ${r.return_period}, Taxable: ${r.taxable_total}`);
  });

  console.log('\n--- Checking normalized_gstr2b_invoices with document date in April 2025 ---');
  const g2bRes = await client.query(`
    SELECT document_number_raw, supplier_name, document_date, return_period, taxable_value
    FROM normalized_gstr2b_invoices
    WHERE document_date >= '2025-04-01' AND document_date <= '2025-04-30'
  `);
  console.log(`Total GSTR-2B invoices in April 2025: ${g2bRes.rows.length}`);
  g2bRes.rows.forEach(r => {
    console.log(`- InvNo: ${r.document_number_raw}, Supplier: ${r.supplier_name}, Date: ${r.document_date}, ReturnPeriod: ${r.return_period}, Taxable: ${r.taxable_value}`);
  });

  await client.end();
}

test().catch(console.error);
