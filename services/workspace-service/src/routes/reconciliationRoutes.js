const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    createRun,
    getRuns,
    getRun,
    getRunResults
} = require('../controllers/reconciliationController');

const {
    createConfig,
    updateConfig,
    listConfigs,
    getConfig
} = require('../controllers/reconciliationConfigController');

// All routes require authentication
router.use(verifyToken);

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

// --- Phase 4.3: Actions ---
const {
    takeAction,
    getPendingActions
} = require('../controllers/reconciliationActionController');

// POST /reconciliation/results/:result_id/actions
router.post('/results/:result_id/actions', takeAction);

// GET /reconciliation/actions/pending
router.get('/actions/pending', getPendingActions);

// GET /reconciliation/runs/:run_id/results
router.get('/runs/:run_id/results', getRunResults);

module.exports = router;
