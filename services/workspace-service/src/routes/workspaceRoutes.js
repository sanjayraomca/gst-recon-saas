const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Base path: /workspaces (mounted in index.js)

router.post('/', verifyToken, workspaceController.createWorkspace);
// router.post('/', (req, res, next) => { req.user = { tenant_id: '9b88e877-d4e8-4d0e-9c30-40cc6934c907', sub: '00000000-0000-0000-0000-000000000000' }; next(); }, workspaceController.createWorkspace);
router.get('/', verifyToken, workspaceController.listWorkspaces);
router.get('/:id', verifyToken, workspaceController.getWorkspace);
router.get('/:id/users', verifyToken, workspaceController.listWorkspaceUsers);
router.post('/:id/users/invite', verifyToken, workspaceController.inviteUser);

module.exports = router;
