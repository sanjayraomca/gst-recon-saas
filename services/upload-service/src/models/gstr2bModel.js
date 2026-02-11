
const knex = require('../../../shared/src/db/connection');

/**
 * Model for GSTR-2B data import operations
 * Updated for New Schema
 */
class GSTR2BModel {
    /**
     * Batch insert invoices into respective tables
     * @param {Object} bulkData { gstr_2b_b2b_invoices: [], gstr_2b_cdnr: [], ... }
     */
    static async bulkInsertNewSchema(bulkData) {
        const trx = await knex.transaction();
        try {
            const batchSize = 200;

            // 1. B2B Invoices
            if (bulkData.gstr_2b_b2b_invoices && bulkData.gstr_2b_b2b_invoices.length > 0) {
                await trx.batchInsert('gstr_2b_b2b_invoices', bulkData.gstr_2b_b2b_invoices, batchSize);
            }

            // 2. CDNR
            if (bulkData.gstr_2b_cdnr && bulkData.gstr_2b_cdnr.length > 0) {
                await trx.batchInsert('gstr_2b_cdnr', bulkData.gstr_2b_cdnr, batchSize);
            }

            // 3. Amendments
            if (bulkData.gstr_2b_b2ba_amendments && bulkData.gstr_2b_b2ba_amendments.length > 0) {
                await trx.batchInsert('gstr_2b_b2ba_amendments', bulkData.gstr_2b_b2ba_amendments, batchSize);
            }

            // 4. Imports
            if (bulkData.gstr_2b_impg && bulkData.gstr_2b_impg.length > 0) {
                await trx.batchInsert('gstr_2b_impg', bulkData.gstr_2b_impg, batchSize);
            }

            await trx.commit();
            return true;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }
}

module.exports = GSTR2BModel;
