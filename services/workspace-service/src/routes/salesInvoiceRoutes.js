const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');
const { syncThirdPartySales } = require('../controllers/salesInvoiceController');

// Third-party sync route:
// - If x-api-key header is present: no Bearer JWT needed (API key is self-contained auth)
// - If x-org-token or Bearer headers used: verifyToken applies
const optionalVerifyToken = (req, res, next) => {
    if (req.headers['x-api-key']) {
        // API key path — skip JWT verification entirely
        return next();
    }
    // All other paths require a valid Bearer JWT
    return verifyToken(req, res, next);
};

router.post('/third-party/sync', optionalVerifyToken, syncThirdPartySales);

module.exports = router;
