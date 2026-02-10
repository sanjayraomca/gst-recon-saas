const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { verifyToken } = require('../../../shared/src/middleware/authMiddleware');

// Base path: /workspaces (mounted in index.js)

router.post('/', verifyToken, workspaceController.createWorkspace);
// router.post('/', (req, res, next) => { req.user = { tenant_id: '6e425ed9-d659-49c5-8182-49e25aafd304', sub: '00000000-0000-0000-0000-000000000000' }; next(); }, workspaceController.createWorkspace);
router.get('/', verifyToken, workspaceController.listWorkspaces);
router.get('/:id', verifyToken, workspaceController.getWorkspace);
router.get('/:id/users', verifyToken, workspaceController.listWorkspaceUsers);
router.post('/:id/users/invite', verifyToken, workspaceController.inviteUser);

module.exports = router;
