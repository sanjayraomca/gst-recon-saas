const knex = require('../../../shared/src/db/connection');

/**
 * Get state by 2-digit code from state_code_master table
 * Used for auto-populating state field based on GSTIN
 */
const getStateByCode = async (req, res) => {
    try {
        let { code } = req.params;
        
        // Robustness: Take only first 2 chars if longer (e.g., handle 24:1 or 24AAB...)
        if (code && code.length > 2) {
            code = code.substring(0, 2);
        }

        // Validate code format
        if (!code || code.length !== 2) {
            return res.status(400).json({
                success: false,
                error: 'Invalid state code. Must be at least 2 digits.'
            });
        }

        // Query state_code_master table
        const state = await knex('state_code_master')
            .where('code', code)
            .first();

        if (!state) {
            return res.status(404).json({
                success: false,
                error: `State not found for code: ${code}`
            });
        }

        return res.json({
            success: true,
            data: state
        });
    } catch (error) {
        console.error('Get state by code error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch state'
        });
    }
};

/**
 * Get all states from state_code_master table
 * Can be used for dropdown population
 */
const getAllStates = async (req, res) => {
    try {
        const states = await knex('state_code_master')
            .select('state', 'code')
            .orderBy('state', 'asc');

        return res.json({
            success: true,
            data: states
        });
    } catch (error) {
        console.error('Get all states error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch states'
        });
    }
};

module.exports = {
    getStateByCode,
    getAllStates
};
