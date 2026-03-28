const db = require('../db/connection');

/**
 * Service to handle Supplier Master operations (Upserts)
 * Shared across Workspace, GSTN, and Import services.
 */
class SupplierMasterService {
    /**
     * Smart Upsert: Adds a supplier if not exists, or updates if changed.
     * Matches by (Workspace + GSTIN) OR (Workspace + Name).
     * 
     * @param {string} workspaceId - Workspace UUID
     * @param {string} gstin - Counterparty GSTIN (nullable)
     * @param {string} name - Clear name (from Books or GSTR)
     * @param {object} trx - Optional Knex Transaction
     */
    static async upsertSupplier(workspaceId, gstin, name, trx = null) {
        if (!workspaceId || (!gstin && !name)) return;

        const cleanGstin = gstin ? gstin.trim().toUpperCase() : null;
        const cleanName = name ? name.trim().substring(0, 255) : '—';
        
        // If GSTIN is invalid length, treat as NULL but continue with Name matching
        const finalGstin = (cleanGstin && cleanGstin.length === 15) ? cleanGstin : null;

        const dbToUse = trx || db;
        
        try {
            // 1. Try matching by GSTIN first (if provided)
            if (finalGstin) {
                const updated = await dbToUse('supplier_master')
                    .where({ workspace_id: workspaceId, gstin: finalGstin })
                    .update({ 
                        supplier_name: cleanName, // Refresh name
                        updated_at: dbToUse.fn.now() 
                    })
                    .returning('id');
                
                if (updated.length > 0) return;
            }

            // 2. Try matching by Name (for Unregistered or mapping fallback)
            const updatedByName = await dbToUse('supplier_master')
                .where({ workspace_id: workspaceId, supplier_name: cleanName })
                .update({ 
                    gstin: finalGstin || dbToUse.raw('gstin'), // Fill GSTIN only if it was missing
                    updated_at: dbToUse.fn.now() 
                })
                .returning('id');

            if (updatedByName.length > 0) return;

            // 3. If no match by GSTIN or Name, Insert new record
            await dbToUse('supplier_master').insert({
                workspace_id: workspaceId,
                gstin: finalGstin,
                supplier_name: cleanName,
                is_active: true,
                created_at: dbToUse.fn.now(),
                updated_at: dbToUse.fn.now()
            });

        } catch (error) {
            // If another process inserted it between our check and insert
            // we catch the unique violation to avoid crashing the import
            if (error.code === '23505') return; 
            
            console.error('[SupplierMasterService] Smart Upsert failed:', error.message);
        }
    }

    /**
     * Batch Upsert for high-performance importing
     */
    static async batchUpsert(workspaceId, suppliers, trx = null) {
        if (!workspaceId || !suppliers?.length) return;

        // Dedup locally by gstin first, then by name
        const deduped = [];
        const gstinSeen = new Set();
        const nameSeen = new Set();

        for (const s of suppliers) {
            if (s.gstin && !gstinSeen.has(s.gstin)) {
                deduped.push(s);
                gstinSeen.add(s.gstin);
            } else if (!s.gstin && !nameSeen.has(s.name)) {
                deduped.push(s);
                nameSeen.add(s.name);
            }
        }
        
        for (const s of deduped) {
            await this.upsertSupplier(workspaceId, s.gstin, s.name, trx);
        }
    }
}

module.exports = SupplierMasterService;
