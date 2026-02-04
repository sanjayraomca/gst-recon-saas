const ReconciliationModel = require('../models/reconciliationModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

/**
 * Trigger reconciliation for a specific GSTIN and period
 */
const createRun = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const runData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'X-Workspace-ID header is required', 400);
        }

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(workspaceId)) {
            return errorResponse(res, 'X-Workspace-ID header must be a valid UUID', 400);
        }

        // Validate required fields
        if (!runData.gstin_id) {
            return errorResponse(res, 'gstin_id is required', 400);
        }

        if (!uuidRegex.test(runData.gstin_id)) {
            return errorResponse(res, 'gstin_id must be a valid UUID', 400);
        }

        if (!runData.period && !runData.period_id) {
            return errorResponse(res, 'period or period_id is required', 400);
        }

        if (runData.period_id && !uuidRegex.test(runData.period_id)) {
            return errorResponse(res, 'period_id must be a valid UUID', 400);
        }

        const runId = await ReconciliationModel.createRun(workspaceId, runData);

        return successResponse(res, { id: runId, status: 'RUNNING' }, 'Reconciliation triggered successfully', 201);
    } catch (error) {
        console.error('Error triggering reconciliation:', error);
        if (error.code === '23503' && error.constraint === 'reconciliation_runs_workspace_id_fkey') {
            return errorResponse(res, 'Workspace not found', 404);
        }
        return errorResponse(res, error.message, 500);
    }
};

const getRuns = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const runs = await ReconciliationModel.getRuns(workspaceId, req.query);
        return successResponse(res, runs, 'Reconciliation runs retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

const getRun = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const run = await ReconciliationModel.getRunById(workspaceId, req.params.run_id);
        if (!run) return errorResponse(res, 'Reconciliation run not found', 404);

        return successResponse(res, run, 'Reconciliation run retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

const getRunResults = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const runId = req.params.run_id;

        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const results = await ReconciliationModel.getRunResults(workspaceId, runId, req.query);
        if (!results) return errorResponse(res, 'Run not found', 404);

        return successResponse(res, results, 'Run results retrieved successfully');
    } catch (error) {
        console.error('Error fetching results:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    createRun,
    getRuns,
    getRun,
    getRunResults
};
