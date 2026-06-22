const knex = require('./services/shared/src/db/connection');
const SupplierMasterService = require('./services/shared/src/services/supplierMasterService');

/**
 * Seed Supplier Master from ALL existing transactions (Registered & Unregistered)
 */
async function seedSupplierMaster() {
    console.log('🚀 Starting Smart Supplier Master seeding...');
    
    try {
        // Get all unique workspace/gstin/name combinations
        // Note: For unregistered, gstin will be null
        const query = `
            WITH all_raw AS (
                SELECT workspace_id, supplier_gstin as gstin, supplier_name as name
                FROM normalized_gstr2b_invoices
                
                UNION
                
                SELECT workspace_id, supplier_gstin as gstin, supplier_name as name
                FROM purchase_vouchers

                UNION

                SELECT workspace_id, customer_gstin as gstin, customer_name as name
                FROM sales_invoices
            )
            SELECT workspace_id, gstin, name
            FROM all_raw
            WHERE name IS NOT NULL OR gstin IS NOT NULL
        `;

        const result = await knex.raw(query);
        const suppliers = result.rows;
        
        console.log(`Found ${suppliers.length} raw combinations to process.`);

        let processed = 0;
        for (const s of suppliers) {
            await SupplierMasterService.upsertSupplier(s.workspace_id, s.gstin, s.name);
            processed++;
            if (processed % 50 === 0) console.log(`Processed ${processed}/${suppliers.length}...`);
        }

        const countRes = await knex.raw('SELECT count(*) FROM supplier_master');
        console.log(`✅ Seeding complete! Total count in supplier_master: ${countRes.rows[0].count}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seedSupplierMaster();
