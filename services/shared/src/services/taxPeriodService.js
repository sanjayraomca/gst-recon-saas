'use strict';

const db = require('../db/connection');

/**
 * TaxPeriodService
 * Centralized service for tax period and financial year resolution.
 */
class TaxPeriodService {

    /**
     * Calculate financial year code (e.g., 2023-24) from a return period (MMYYYY).
     */
    static calculateFinancialYear(returnPeriod) {
        if (!returnPeriod || (returnPeriod.length !== 6)) return null;

        let month, year;
        // Check if format is YYYYMM (e.g. 202510) instead of MMYYYY (e.g. 102025)
        if (returnPeriod.startsWith('20') && parseInt(returnPeriod.substring(4)) <= 12) {
            year = parseInt(returnPeriod.substring(0, 4));
            month = parseInt(returnPeriod.substring(4));
        } else {
            month = parseInt(returnPeriod.substring(0, 2));
            year = parseInt(returnPeriod.substring(2));
        }

        if (isNaN(month) || isNaN(year)) {
            console.error(`[TaxPeriodService] Invalid month/year parsed from returnPeriod: ${returnPeriod}`);
            return null;
        }

        if (month >= 4) {
            return `${year}-${(year + 1).toString().substring(2)}`;
        } else {
            return `${year - 1}-${year.toString().substring(2)}`;
        }
    }

    /**
     * Ensure a tax period exists in the database. 
     * If not found, it resolves the financial year first and then creates the period.
     */
    static async ensureTaxPeriodExists(returnPeriod, trx = null) {
        if (!returnPeriod || returnPeriod.length !== 6) return null;

        const query = (trx || db);

        // 1. Check if Tax Period exists
        const periodMatch = await query('tax_periods')
            .select('id')
            .where('period_code', returnPeriod)
            .first();

        if (periodMatch) {
            return periodMatch.id;
        }

        console.log(`[TaxPeriodService] Creating missing tax period: ${returnPeriod}`);
        
        let month, year;
        // Handle YYYYMM (e.g. 202510) or MMYYYY (e.g. 102025)
        if (returnPeriod.startsWith('20') && parseInt(returnPeriod.substring(4)) <= 12) {
            year = parseInt(returnPeriod.substring(0, 4));
            month = parseInt(returnPeriod.substring(4));
        } else {
            month = parseInt(returnPeriod.substring(0, 2));
            year = parseInt(returnPeriod.substring(2));
        }

        const fyCode = TaxPeriodService.calculateFinancialYear(returnPeriod);

        // 2. Resolve or Create Financial Year
        let fyId;
        const fyMatch = await query('financial_years')
            .select('id')
            .where('fy_code', fyCode)
            .first();

        if (fyMatch) {
            fyId = fyMatch.id;
        } else {
            console.log(`[TaxPeriodService] Creating missing financial year: ${fyCode}`);
            const startYear = parseInt(fyCode.split('-')[0]);

            if (isNaN(startYear)) {
                throw new Error(`Failed to parse startYear from fyCode: ${fyCode}`);
            }

            const startDate = `${startYear}-04-01`;
            const endDate = `${startYear + 1}-03-31`;

            try {
                const [insertedFy] = await query('financial_years')
                    .insert({
                        fy_code: fyCode,
                        display_name: `FY ${fyCode}`,
                        start_date: startDate,
                        end_date: endDate
                    })
                    .returning('id');
                fyId = insertedFy?.id ?? insertedFy;
            } catch (dbErr) {
                console.error(`[TaxPeriodService] Error inserting FY ${fyCode}:`, dbErr.message);
                throw dbErr;
            }
        }

        // 3. Create Tax Period
        const mStr = month.toString().padStart(2, '0');
        const startDate = `${year}-${mStr}-01`;
        const dateObj = new Date(year, month, 0); // Last day of month
        const endDate = `${year}-${mStr}-${dateObj.getDate().toString().padStart(2, '0')}`;
        const quarter = month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4;
        const displayName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

        const [insertedPeriod] = await query('tax_periods')
            .insert({
                fy_id: fyId,
                month: month,
                year: year,
                period_code: returnPeriod,
                display_name: displayName,
                start_date: startDate,
                end_date: endDate,
                period_type: 'MONTHLY',
                quarter: quarter
            })
            .returning('id');

        const newId = insertedPeriod?.id ?? insertedPeriod;
        return newId;
    }
}

module.exports = TaxPeriodService;
