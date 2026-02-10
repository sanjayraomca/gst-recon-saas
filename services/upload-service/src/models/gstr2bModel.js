const knex = require('../../../shared/src/db/connection');

/**
 * Model for GSTR-2B data import operations
 */
class GSTR2BModel {
    /**
     * Batch insert invoices into gstr2b_invoices
     * @param {Object[]} invoices 
     */
    static async insertInvoices(invoices) {
        if (!invoices || invoices.length === 0) return 0;
        // Use batch insert for performance
        return knex.batchInsert('gstr2b_invoices', invoices, 100);
    }

    /**
     * Batch insert summaries into gstr2b_summaries
     * @param {Object[]} summaries 
     */
    static async insertSummaries(summaries) {
        if (!summaries || summaries.length === 0) return 0;
        return knex.batchInsert('gstr2b_summaries', summaries, 100);
    }

    /**
     * Batch insert imports into gstr2b_imports
     * @param {Object[]} imports 
     */
    static async insertImports(imports) {
        if (!imports || imports.length === 0) return 0;
        return knex.batchInsert('gstr2b_imports', imports, 100);
    }

    /**
     * Batch insert ISD credits into gstr2b_isd_credits
     * @param {Object[]} credits 
     */
    static async insertISDCredits(credits) {
        if (!credits || credits.length === 0) return 0;
        return knex.batchInsert('gstr2b_isd_credits', credits, 100);
    }

    /**
     * Get tax period ID by period string (e.g., '062025')
     * @param {string} taxPeriod 
     * @returns {string|null}
     */
    static async getTaxPeriodId(taxPeriod) {
        const period = await knex('tax_periods')
            .where({ period_code: taxPeriod })
            .select('id')
            .first();
        return period ? period.id : null;
    }

    /**
     * Create a backup record for the import job
     * @param {Object} data 
     */
    static async createImportJob(data) {
        const [job] = await knex('gstr2b_imports') // Using imports table as a log for now or if I should create a separate metadata table
            .insert(data)
            .returning('*');
        return job;
    }
}

module.exports = GSTR2BModel;
