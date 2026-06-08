const BookDataModel = require('../services/workspace-service/src/models/bookDataModel');
const knex = require('../services/shared/src/db/connection');

async function test() {
  try {
    // Let's find a workspace ID that has sales invoices
    const sampleInvoice = await knex('sales_invoices').first();
    if (!sampleInvoice) {
      console.log('No sales invoices found in the database. Please seed or check database.');
      await knex.destroy();
      return;
    }

    const workspaceId = sampleInvoice.workspace_id;
    console.log(`Using workspace ID: ${workspaceId}`);

    // Call BookDataModel.getByType for sales_invoice
    const result = await BookDataModel.getByType(workspaceId, 'sales_invoice', { page_size: 10 });
    console.log('Successfully fetched sales invoices from BookDataModel:');
    console.log(`Total count: ${result.pagination.total}`);
    
    // Print the first 5 records with their key fields including platform
    const records = result.data.slice(0, 5);
    console.log('First 5 records:');
    records.forEach(r => {
      console.log({
        id: r.id,
        invoiceNo: r.invoiceNo,
        date: r.date,
        party: r.party,
        gstin: r.gstin,
        platform: r.platform,
        taxableAmt: r.taxableAmt,
        totalAmt: r.totalAmt
      });
    });

  } catch (err) {
    console.error('Error in test:', err);
  } finally {
    await knex.destroy();
  }
}

test();
