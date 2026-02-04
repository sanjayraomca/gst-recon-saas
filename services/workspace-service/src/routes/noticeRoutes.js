const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const NoticeController = require('../controllers/noticeController');

// All routes require authentication
router.use(verifyToken);

// GET /notices - List notices
router.get('/', NoticeController.listNotices);

// POST /notices - Manual notice creation
router.post('/', NoticeController.createNotice);

// GET /notices/:notice_id - Build/Get Notice Details
router.get('/:notice_id', NoticeController.getNotice);

// POST /notices/:notice_id/defense-pack - Generate Defense Pack
router.post('/:notice_id/defense-pack', NoticeController.generateDefensePack);

// POST /notices/:notice_id/response - Submit Response
router.post('/:notice_id/response', NoticeController.submitResponse);

module.exports = router;
