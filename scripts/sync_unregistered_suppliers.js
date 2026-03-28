const knex = require('/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/shared/node_modules/knex')({
    client: 'pg',
    connection: {
        host: 'localhost',
        port: 5435,
        user: 'gstadmin',
        password: 'GstAdmin123',
        database: 'gst_recon'
    }
});

process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5435';
process.env.DB_USER = 'gstadmin';
process.env.DB_PASSWORD = 'GstAdmin123';
process.env.DB_NAME = 'gst_recon';

const SupplierMasterService = require('/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/shared/src/services/supplierMasterService');

async function syncUnregistered() {
    console.log('Starting sync for unregistered suppliers...');
    
    try {
        // 1. Scan GSTR 2B B2B
        console.log('Scanning GSTR 2B B2B...');
        const gstr2b = await knex('gstr_2b_b2b_invoices')
            .select('workspace_id', 'gstin_supplier as gstin', 'trade_name as name');
        
        // 2. Scan Sales Invoices
        console.log('Scanning Sales Invoices...');
        const sales = await knex('sales_invoices')
            .select('workspace_id', 'customer_gstin as gstin', 'customer_name as name');
            
        // 3. Scan Purchase Vouchers
        console.log('Scanning Purchase Vouchers...');
        const purchases = await knex('purchase_vouchers')
            .select('workspace_id', 'supplier_gstin as gstin', 'supplier_name as name');

        // Combine and filter unique by (workspace_id, gstin, name)
        const all = [...gstr2b, ...sales, ...purchases];
        const uniqueMap = new Map();
        
        all.forEach(r => {
            const key = `${r.workspace_id}_${r.gstin || ''}_${r.name || ''}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, r);
            }
        });

        const toSync = Array.from(uniqueMap.values());
        console.log(`Found ${toSync.length} total potential entities. Processing upserts...`);

        // Batch upsert by workspace
        const byWorkspace = toSync.reduce((acc, r) => {
            if (!acc[r.workspace_id]) acc[r.workspace_id] = [];
            acc[r.workspace_id].push({ gstin: r.gstin, name: r.name });
            return acc;
        }, {});

        for (const [wsId, suppliers] of Object.entries(byWorkspace)) {
            console.log(`Syncing ${suppliers.length} suppliers for workspace ${wsId}...`);
            await SupplierMasterService.batchUpsert(wsId, suppliers);
        }

        console.log('Sync completed successfully.');

    } catch (err) {
        console.error('Error during sync:', err);
    } finally {
        process.exit();
    }
}

syncUnregistered();
