const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const {
    getConnectorLogs,
    getConnectorLogById,
    getConnectorLogStats
} = require('../controllers/connectorLogController');

// All routes require a valid Bearer JWT
router.use(verifyToken);

// GET /connector-logs/stats — summary cards (must be before /:id)
router.get('/stats', getConnectorLogStats);

// GET /connector-logs — paginated list with filters
router.get('/', getConnectorLogs);

// GET /connector-logs/:id — single record detail
router.get('/:id', getConnectorLogById);

module.exports = router;
