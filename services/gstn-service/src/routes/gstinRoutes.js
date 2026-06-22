const express = require('express');
const router = express.Router();
const gstinController = require('../controllers/gstinController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Base path: /gstins (mounted in index.js)

router.post('/', verifyToken, gstinController.createGSTIN);
router.post('/test-connection', gstinController.testGSTNConnection); // Test GSTN connection (no auth needed for testing)
router.get('/', verifyToken, gstinController.listGSTINs);
router.get('/:id', verifyToken, gstinController.getGSTIN);
router.put('/:id', verifyToken, gstinController.updateGSTIN);

module.exports = router;
