const db = require('../db/connection');

/**
 * Service to handle Customer Master operations (Upserts)
 * Shared across Workspace and Import services.
 */
class CustomerMasterService {
    /**
     * Smart Upsert: Adds a customer if not exists, or updates if changed.
     * Matches by (Workspace + GSTIN) OR (Workspace + Name).
     * 
     * @param {string} workspaceId - Workspace UUID
     * @param {string} gstin - Counterparty GSTIN (nullable)
     * @param {string} name - Clear name (from Books or GSTR)
     * @param {object} trx - Optional Knex Transaction
     */
    static async upsertCustomer(workspaceId, gstin, name, trx = null) {
        if (!workspaceId || (!gstin && !name)) return;

        const cleanGstin = gstin ? gstin.trim().toUpperCase() : null;
        const cleanName = name ? name.trim().substring(0, 255) : '—';
        
        // If GSTIN is invalid length, treat as NULL but continue with Name matching
        const finalGstin = (cleanGstin && cleanGstin.length === 15) ? cleanGstin : null;

        const dbToUse = trx || db;
        
        try {
            // 1. Try matching by GSTIN first (if provided)
            if (finalGstin) {
                const updated = await dbToUse('customer_master')
                    .where({ workspace_id: workspaceId, gstin: finalGstin })
                    .update({ 
                        customer_name: cleanName, // Refresh name
                        updated_at: dbToUse.fn.now() 
                    })
                    .returning('id');
                
                if (updated.length > 0) return updated[0].id;
            }

            // 2. Try matching by Name (for Unregistered or mapping fallback)
            const updatedByName = await dbToUse('customer_master')
                .where({ workspace_id: workspaceId, customer_name: cleanName })
                .update({ 
                    gstin: finalGstin || dbToUse.raw('gstin'), // Fill GSTIN only if it was missing
                    updated_at: dbToUse.fn.now() 
                })
                .returning('id');

            if (updatedByName.length > 0) return updatedByName[0].id;

            // 3. If no match by GSTIN or Name, Insert new record
            const inserted = await dbToUse('customer_master').insert({
                workspace_id: workspaceId,
                gstin: finalGstin,
                customer_name: cleanName,
                is_active: true,
                created_at: dbToUse.fn.now(),
                updated_at: dbToUse.fn.now()
            }).returning('id');

            return inserted[0].id;

        } catch (error) {
            // If another process inserted it between our check and insert
            if (error.code === '23505') {
                const existing = await dbToUse('customer_master')
                    .where({ workspace_id: workspaceId, gstin: finalGstin })
                    .select('id').first();
                return existing?.id;
            } 
            
            console.error('[CustomerMasterService] Smart Upsert failed:', error.message);
            return null;
        }
    }

    /**
     * Batch Upsert for high-performance importing
     */
    static async batchUpsert(workspaceId, customers, trx = null) {
        if (!workspaceId || !customers?.length) return;

        // Dedup locally by gstin first, then by name
        const deduped = [];
        const gstinSeen = new Set();
        const nameSeen = new Set();

        for (const c of customers) {
            if (c.gstin && !gstinSeen.has(c.gstin)) {
                deduped.push(c);
                gstinSeen.add(c.gstin);
            } else if (!c.gstin && !nameSeen.has(c.name)) {
                deduped.push(c);
                nameSeen.add(c.name);
            }
        }
        
        for (const c of deduped) {
            await this.upsertCustomer(workspaceId, c.gstin, c.name, trx);
        }
    }
}

module.exports = CustomerMasterService;
