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

  const invs = ['3250859', '3282509', 'MF2624I000030115'];
  
  for (const inv of invs) {
    const res = await client.query(`
      SELECT id, document_number_raw, supplier_name, supplier_gstin, taxable_value, return_period, filing_period
      FROM normalized_gstr2b_invoices
      WHERE document_number_raw LIKE $1 OR amended_document_number LIKE $1
    `, [`%${inv}%`]);
    
    console.log(`\nSearch for GSTR-2B matching "${inv}":`);
    if (res.rows.length > 0) {
      res.rows.forEach(r => {
        console.log(`- FOUND: Inv: ${r.document_number_raw}, Supplier: ${r.supplier_name}, GSTIN: ${r.supplier_gstin}, Taxable: ${r.taxable_value}, ReturnPeriod: ${r.return_period}`);
      });
    } else {
      console.log(`- NOT FOUND on Portal (GSTR-2B)`);
    }
  }

  await client.end();
}

test().catch(console.error);
