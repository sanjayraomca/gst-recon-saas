const express = require('express');
const router = express.Router();
const stateController = require('../controllers/stateController');

// Get state by 2-digit code (e.g., /api/states/by-code/27)
router.get('/by-code/:code', stateController.getStateByCode);

// Get all states
router.get('/', stateController.getAllStates);

module.exports = router;
