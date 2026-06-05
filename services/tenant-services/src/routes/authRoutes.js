const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

router.post('/login', authController.login);
router.post('/third-party-login', authController.thirdPartyLogin);
router.post('/register', authController.register);
router.post('/refresh', authController.refresh);
router.get('/profile', verifyToken, authController.getProfile);
router.put('/profile', verifyToken, authController.updateProfile);
router.post('/accept-invite', authController.acceptInvite);
router.get('/verify-invite/:token', authController.verifyInvite);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.put('/change-password', verifyToken, authController.changePassword);

// Third-party API Key Management (requires login)
router.post('/third-party/generate-api-key', verifyToken, authController.generateApiKey);
router.get('/third-party/api-keys', verifyToken, authController.listApiKeys);
router.delete('/third-party/api-keys/:id', verifyToken, authController.revokeApiKey);

module.exports = router;

