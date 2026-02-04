const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const VendorCommController = require('../controllers/vendorCommController');

router.use(verifyToken);

// GET /vendor-communications - List
router.get('/', VendorCommController.listCommunications);

// POST /vendor-communications - Send
router.post('/', VendorCommController.sendCommunication);

module.exports = router;
