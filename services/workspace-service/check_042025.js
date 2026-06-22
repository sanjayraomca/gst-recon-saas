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
  
  // Check return_periods in purchase_vouchers
  const pvPeriods = await client.query("SELECT DISTINCT return_period FROM purchase_vouchers");
  console.log('Distinct return_periods in purchase_vouchers:', pvPeriods.rows.map(r => r.return_period));

  // Check return_periods in normalized_gstr2b_invoices
  const g2bPeriods = await client.query("SELECT DISTINCT return_period FROM normalized_gstr2b_invoices");
  console.log('Distinct return_periods in normalized_gstr2b_invoices:', g2bPeriods.rows.map(r => r.return_period));

  // Let's query records for 042025 in purchase_vouchers
  const pvList = await client.query(`
    SELECT book_vchr_no, supplier_invoice_no, supplier_name, supplier_gstin, supplier_invoice_date, taxable_total, net_amount, return_period
    FROM purchase_vouchers
    WHERE return_period = '042025' OR return_period = '04-2025'
  `);
  console.log(`\n--- Purchase Vouchers (Count: ${pvList.rows.length}) ---`);
  pvList.rows.forEach((r, i) => {
    console.log(`${i+1}. VchrNo: ${r.book_vchr_no}, InvNo: ${r.supplier_invoice_no}, Supplier: ${r.supplier_name}, GSTIN: ${r.supplier_gstin.trim()}, Date: ${r.supplier_invoice_date}, Taxable: ${r.taxable_total}, Net: ${r.net_amount}`);
  });

  // Let's query records for 042025 in normalized_gstr2b_invoices
  const g2bList = await client.query(`
    SELECT document_number_raw, supplier_name, supplier_gstin, document_date, taxable_value, document_value, return_period
    FROM normalized_gstr2b_invoices
    WHERE return_period = '042025' OR return_period = '04-2025'
  `);
  console.log(`\n--- GSTR-2B Invoices (Count: ${g2bList.rows.length}) ---`);
  g2bList.rows.forEach((r, i) => {
    console.log(`${i+1}. RawDocNo: ${r.document_number_raw}, Supplier: ${r.supplier_name}, GSTIN: ${r.supplier_gstin.trim()}, Date: ${r.document_date}, Taxable: ${r.taxable_value}, Val: ${r.document_value}`);
  });

  await client.end();
}

test().catch(console.error);
