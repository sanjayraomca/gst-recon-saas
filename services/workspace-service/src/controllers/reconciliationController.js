const ReconciliationModel = require('../models/reconciliationModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const progressEmitter = require('../utils/progressEmitter');
const { attachSqlFileLogger } = require('../utils/sqlFileLogger');


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

        await logActivity({
            userId: req.user?.db_id || req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'RECONCILIATION_RUN',
            entityType: 'Reconciliation',
            entityId: runId,
            details: { gstinId: runData.gstin_id, period: runData.period || runData.period_id },
            req
        });

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

        const hasFilters = Object.keys(req.query || {}).length > 0;
        const transactionName = hasFilters ? 'FilterReconResults' : 'FetchReconResults';
        const cleanup = attachSqlFileLogger(transactionName);
        const result = await ReconciliationModel.getRunResults(workspaceId, runId, req.query);
        cleanup();
        if (!result) return errorResponse(res, 'Run not found', 404);

        return successResponse(res, result.data, 'Run results retrieved successfully', 200, {
            pagination: result.pagination,
            summary: result.summary
        });
    } catch (error) {
        console.error('Error fetching results:', error);
        return errorResponse(res, error.message, 500);
    }
};

const getRunTaxSummary = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const runId = req.params.run_id;
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);
        const cleanup = attachSqlFileLogger('TaxSummary');
        const summary = await ReconciliationModel.getRunTaxSummary(workspaceId, runId, req.query);
        cleanup();
        return successResponse(res, summary, 'Tax summary retrieved successfully');
    } catch (error) {
        console.error('Error fetching tax summary:', error);
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Stream Server-Sent Events (SSE) for reconciliation progress tracking
 */
const getRunProgress = (req, res) => {
    const runId = req.query.run_id || req.params.run_id;

    if (!runId) {
        return res.status(400).json({ success: false, error: 'run_id is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Immediately flush headers so fetch connection resolves
    res.flushHeaders();

    const sendProgress = (data) => {
        if (data.runId === runId) {
            res.write(`data: ${JSON.stringify({ progress: data.progress, message: data.message, error: data.error })}\n\n`);

            if (data.progress >= 100 || data.error) {
                // Give frontend time to receive before closing
                setTimeout(() => res.end(), 1000);
            }
        }
    };

    progressEmitter.on('progress', sendProgress);

    req.on('close', () => {
        progressEmitter.removeListener('progress', sendProgress);
    });
};

module.exports = {
    createRun,
    getRuns,
    getRun,
    getRunResults,
    getRunProgress,
    getRunTaxSummary
};
