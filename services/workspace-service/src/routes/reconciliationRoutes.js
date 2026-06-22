const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    createRun,
    getRuns,
    getRun,
    getRunResults,
    getRunProgress,
    getRunTaxSummary,
    getReconBookData
} = require('../controllers/reconciliationController');

const { authorizeWorkspace } = require('../middleware/workspaceAuthMiddleware');

const {
    createConfig,
    updateConfig,
    listConfigs,
    getConfig
} = require('../controllers/reconciliationConfigController');

// All routes require authentication and workspace authorization
router.use(verifyToken);
router.use(authorizeWorkspace);

// --- Phase 4.1: Configurations ---
// GET /reconciliation/configs
router.get('/configs', listConfigs);

// POST /reconciliation/configs
router.post('/configs', createConfig);

// GET /reconciliation/configs/:config_id
router.get('/configs/:config_id', getConfig);

// PUT /reconciliation/configs/:config_id
router.put('/configs/:config_id', updateConfig);


// --- Phase 4.2: Runs ---
// POST /reconciliation/runs - Start reconciliation run
router.post('/runs', createRun);

// GET /reconciliation/runs - List runs
router.get('/runs', getRuns);

// GET /reconciliation/runs/:run_id - Get run details
router.get('/runs/:run_id', getRun);

// GET /reconciliation/runs/:run_id/progress - Stream run progress (SSE)
router.get('/runs/:run_id/progress', getRunProgress);

// GET /reconciliation/progress?run_id=... - Alternative SSE route
router.get('/progress', getRunProgress);

// --- Phase 4.3: Actions ---
const {
    takeAction,
    getPendingActions,
    updateReconStatus,
    notifySupplier
} = require('../controllers/reconciliationActionController');

// POST /reconciliation/results/:result_id/actions
router.post('/results/:result_id/actions', takeAction);

// POST /reconciliation/notify-supplier
router.post('/notify-supplier', notifySupplier);

// GET /reconciliation/actions/pending
router.get('/actions/pending', getPendingActions);

// PUT /reconciliation/status/:result_id - Update reconciliation_status table
router.put('/status/:result_id', updateReconStatus);

// GET /reconciliation/runs/:run_id/results
router.get('/runs/:run_id/results', getRunResults);

// GET /reconciliation/runs/:run_id/tax-summary
router.get('/runs/:run_id/tax-summary', getRunTaxSummary);

// GET /reconciliation/book-data - Dedicated endpoint for Book Data tab
router.get('/book-data', getReconBookData);

module.exports = router;
