const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

router.post('/', verifyToken, supplierController.createSupplier);
router.get('/', verifyToken, supplierController.listSuppliers);
router.get('/:id', verifyToken, supplierController.getSupplier);
router.put('/:id', verifyToken, supplierController.updateSupplier);

module.exports = router;
