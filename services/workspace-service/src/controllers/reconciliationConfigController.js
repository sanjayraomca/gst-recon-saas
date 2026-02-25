const ReconciliationConfigModel = require('../models/reconciliationConfigModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');
const { logActivity } = require('../../../shared/src/utils/activityLogger');

const createConfig = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const config = await ReconciliationConfigModel.create(workspaceId, req.body, req.user?.id);

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'CREATE_RECON_CONFIG',
            entityType: 'ReconConfig',
            entityId: config.id,
            details: { type: req.body.config_type },
            req
        });

        return successResponse(res, config, 'Configuration created successfully', 201);
    } catch (error) {
        console.error('Error creating config:', error);
        return errorResponse(res, error.message, 500);
    }
};

const updateConfig = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const configId = req.params.config_id;
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const config = await ReconciliationConfigModel.update(workspaceId, configId, req.body);
        if (!config) return errorResponse(res, 'Configuration not found', 404);

        await logActivity({
            userId: req.user?.id,
            tenantId: req.user?.tenant_id,
            workspaceId,
            actionType: 'UPDATE_RECON_CONFIG',
            entityType: 'ReconConfig',
            entityId: config.id,
            details: { configId },
            req
        });

        return successResponse(res, config, 'Configuration updated successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

const getConfig = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        const configId = req.params.config_id;
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const config = await ReconciliationConfigModel.getById(workspaceId, configId);
        if (!config) return errorResponse(res, 'Configuration not found', 404);

        return successResponse(res, config, 'Configuration retrieved successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

const listConfigs = async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'];
        if (!workspaceId) return errorResponse(res, 'X-Workspace-ID header is required', 400);

        const filters = {
            config_type: req.query.config_type,
            is_active: req.query.is_active
        };

        const configs = await ReconciliationConfigModel.list(workspaceId, filters, req.query);
        return successResponse(res, configs, 'Configurations listed successfully');
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

module.exports = {
    createConfig,
    updateConfig,
    getConfig,
    listConfigs
};
