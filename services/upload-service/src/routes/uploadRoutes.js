const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

router.post('/', verifyToken, uploadController.uploadMiddleware, uploadController.uploadFile);
router.get('/', verifyToken, uploadController.listUploads);
router.get('/:id', verifyToken, uploadController.getUpload);

module.exports = router;
