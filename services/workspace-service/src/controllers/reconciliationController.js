const ReconciliationModel = require('../models/reconciliationModel');
const Reconciliation2AModel = require('../models/reconciliation2AModel');
const BookDataModel = require('../models/bookDataModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');
const progressEmitter = require('../utils/progressEmitter');
const { attachSqlFileLogger } = require('../utils/sqlFileLogger');


/**
 * Trigger reconciliation for a specific GSTIN and period
 */
const createRun = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        const runData = req.body;

        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
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

        // Dispatch to the correct model based on run_type
        const is2aRun = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(runData.run_type);
        const model = is2aRun ? Reconciliation2AModel : ReconciliationModel;
        const runId = await model.createRun(workspaceId, runData);

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
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

        const runs = await ReconciliationModel.getRuns(workspaceId, req.query);
        return successResponse(res, runs, 'Reconciliation runs retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

const getRun = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

        const run = await ReconciliationModel.getRunById(workspaceId, req.params.run_id);
        if (!run) return errorResponse(res, 'Reconciliation run not found', 404);

        return successResponse(res, run, 'Reconciliation run retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

/**
 * Get B2B purchase vouchers for the reconciliation dashboard (Book Data tab)
 */
const getReconBookData = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        if (!workspaceId) {
            return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);
        }

        const filters = {
            gstin_id: req.query.gstin_id,
            fy_id: req.query.fy_id,
            month: req.query.month,
            quarter: req.query.quarter,
            search: req.query.search,
            page: parseInt(req.query.page) || 1,
            page_size: parseInt(req.query.page_size) || 25,
            run_type: req.query.run_type || 'PURCHASE_2B'
        };

        const result = await BookDataModel.getReconBookData(workspaceId, filters);
        return successResponse(res, result);
    } catch (error) {
        console.error('[Get Recon Book Data Error]:', error);
        return errorResponse(res, error.message || 'Failed to fetch book data');
    }
};

const getRunResults = async (req, res) => {
    try {
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        const runId = req.params.run_id;

        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

        let finalRunId = runId;
        let model = ReconciliationModel;

        if (runId === 'latest') {
            const runType = req.query.run_type || 'PURCHASE_2B';
            const latestRun = await ReconciliationModel.getLatestRun(workspaceId, runType);
            if (!latestRun) {
                return successResponse(res, [], 'No runs found for this workspace', 200, {
                    pagination: { total: 0, total_pages: 1 },
                    summary: {
                        totals: {},
                        mismatch_by_status: {},
                        mismatch_by_priority: {}
                    }
                });
            }
            finalRunId = latestRun.id;
            
            const is2aRun = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(latestRun.run_type);
            if (is2aRun) model = Reconciliation2AModel;
        } else if (runId !== 'all') {
            const run = await ReconciliationModel.getRunById(workspaceId, runId);
            if (!run) return errorResponse(res, 'Run not found', 404);

            const is2aRun = ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run.run_type);
            if (is2aRun) {
                model = Reconciliation2AModel;
            }
        } else if (req.query.run_type && ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(req.query.run_type)) {
            model = Reconciliation2AModel;
        }

        const hasFilters = Object.keys(req.query || {}).length > 0;
        const transactionName = hasFilters ? 'FilterReconResults' : 'FetchReconResults';
        const cleanup = attachSqlFileLogger(transactionName);

        const result = await model.getRunResults(workspaceId, finalRunId, req.query);

        cleanup();
        if (!result) return errorResponse(res, 'Results not found', 404);

        // Log Activity
        await logActivity({
            userId: req.user?.db_id || req.user?.id || req.user?.sub,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'VIEW_RECONCILIATION_RESULTS',
            entityType: 'RECONCILIATION',
            entityId: finalRunId !== 'all' && finalRunId !== 'latest' ? finalRunId : null,
            details: { 
                page_name: 'Reconciliation Results',
                runId: finalRunId, 
                filters: req.query 
            },
            req
        });

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
        const workspaceId = req.workspace_id || req.headers['x-workspace-id'];
        const runId = req.params.run_id;
        if (!workspaceId) return errorResponse(res, 'Workspace ID is required (provide x-workspace-id header)', 400);

        // Dispatcher: Determine which model to use
        let model = ReconciliationModel;
        let finalRunId = runId;

        if (runId === 'latest') {
            const runType = req.query.run_type || 'PURCHASE_2B';
            const latestRun = await ReconciliationModel.getLatestRun(workspaceId, runType);
            if (!latestRun) {
                return successResponse(res, {
                    totals: {},
                    mismatch_by_status: {},
                    mismatch_by_priority: {}
                }, 'No reconciliation runs found for this workspace');
            }
            finalRunId = latestRun.id;
        }

        if (finalRunId !== 'all') {
            const run = await ReconciliationModel.getRunById(workspaceId, finalRunId);
            const is2aRun = run && ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(run.run_type);
            if (is2aRun) {
                model = Reconciliation2AModel;
            }
        } else if (req.query.run_type && ['PURCHASE_2A', 'GSTR2A_VS_GSTR2B', 'PURCHASE_2A_VS_2B'].includes(req.query.run_type)) {
            model = Reconciliation2AModel;
        }

        const cleanup = attachSqlFileLogger('TaxSummary');
        const summary = await model.getRunTaxSummary(workspaceId, finalRunId, req.query);
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
    getRunTaxSummary,
    getReconBookData
};
