'use strict';

const db = require('../db/connection');

/**
 * GstinMasterService
 * Reusable service for GSTIN master table lookups and upserts.
 * Can be used by any microservice that shares the same DB connection.
 */
class GstinMasterService {

    /**
     * Ensure a GSTIN exists in gstin_master.
     * If the GSTIN is not found, a minimal record is inserted.
     *
     * @param {string} gstin            - 15-character GSTIN string
     * @param {object} [defaults={}]    - Optional defaults for new records
     * @param {string} [defaults.legal_name]         - Supplier / party name
     * @param {string} [defaults.registration_type]  - GST registration type (default: 'REGULAR')
     * @param {object|null} [trx=null]  - Optional Knex transaction object.
     *                                    Pass the active transaction when calling
     *                                    from inside a transaction block.
     * @returns {Promise<string|null>}  - The UUID (id) from gstin_master, or null if gstin is falsy.
     */
    static async ensureGstin(gstin, defaults = {}, trx = null) {
        if (!gstin || typeof gstin !== 'string') return null;

        const cleanGstin = gstin.trim().toUpperCase();
        if (cleanGstin.length < 15) {
            console.warn(`[GstinMasterService] Skipping short/invalid GSTIN: "${cleanGstin}"`);
            return null;
        }

        const stateCode = cleanGstin.substring(0, 2);
        const legalName = (defaults.legal_name || '').trim() || 'Unknown';
        const registrationType = defaults.registration_type || 'REGULAR';

        const query = (trx || db);

        try {
            // Try to get existing record first
            const existing = await query('gstin_master')
                .select('id')
                .where('gstin', cleanGstin)
                .first();

            if (existing) {
                return existing.id;
            }

            // Insert minimal record
            const [inserted] = await query('gstin_master')
                .insert({
                    gstin: cleanGstin,
                    legal_name: legalName,
                    registration_type: registrationType,
                    state_code: stateCode,
                })
                .returning('id');

            const newId = inserted?.id ?? inserted;
            console.log(`[GstinMasterService] Inserted new gstin_master record for: ${cleanGstin} (id: ${newId})`);
            return newId;

        } catch (err) {
            // Handle race-condition duplicate (another worker inserted concurrently)
            if (err.code === '23505') {
                const fallback = await query('gstin_master')
                    .select('id')
                    .where('gstin', cleanGstin)
                    .first();
                return fallback?.id ?? null;
            }
            console.error(`[GstinMasterService] Error upserting GSTIN "${cleanGstin}":`, err.message);
            throw err;
        }
    }

    /**
     * Bulk-ensure multiple GSTINs in a single call.
     * Useful when processing a batch of invoices.
     *
     * @param {string[]} gstins         - Array of GSTIN strings
     * @param {object|null} [trx=null]  - Optional Knex transaction object
     * @returns {Promise<Map<string, string>>} - Map of GSTIN → gstin_master UUID
     */
    static async ensureMultiple(gstins, trx = null) {
        const unique = [...new Set(
            gstins
                .filter(Boolean)
                .map(g => g.trim().toUpperCase())
                .filter(g => g.length === 15)
        )];

        if (!unique.length) return new Map();

        const query = (trx || db);
        const result = new Map();

        // Fetch existing records in one query
        const existing = await query('gstin_master')
            .select('id', 'gstin')
            .whereIn('gstin', unique);

        existing.forEach(row => result.set(row.gstin, row.id));

        // Insert missing ones individually (to capture their IDs)
        const missing = unique.filter(g => !result.has(g));
        for (const gstin of missing) {
            const stateCode = gstin.substring(0, 2);
            try {
                const [inserted] = await query('gstin_master')
                    .insert({
                        gstin,
                        legal_name: 'Unknown',
                        registration_type: 'REGULAR',
                        state_code: stateCode,
                    })
                    .returning('id');

                const newId = inserted?.id ?? inserted;
                result.set(gstin, newId);
                console.log(`[GstinMasterService] Batch-inserted gstin_master: ${gstin}`);
            } catch (err) {
                if (err.code === '23505') {
                    const fallback = await query('gstin_master')
                        .select('id').where('gstin', gstin).first();
                    if (fallback) result.set(gstin, fallback.id);
                } else {
                    throw err;
                }
            }
        }

        return result;
    }
}

module.exports = GstinMasterService;
