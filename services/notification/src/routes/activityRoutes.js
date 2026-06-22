
const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

router.get('/', verifyToken, activityController.getActivities);

module.exports = router;
