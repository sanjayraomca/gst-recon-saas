const VendorCommModel = require('../models/vendorCommModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

const listCommunications = async (req, res) => {
    try {
        const { page = 1, page_size = 20, ...filters } = req.query;
        filters.workspace_id = req.headers['x-workspace-id'];

        if (!filters.workspace_id) return errorResponse(res, { message: 'Workspace ID required' }, 400);

        const comms = await VendorCommModel.findAll(filters, { page, page_size });
        return successResponse(res, comms, 'Vendor communications fetched');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const sendCommunication = async (req, res) => {
    try {
        const data = req.body;
        data.workspace_id = req.headers['x-workspace-id'];
        data.created_by = req.user.id;

        // TODO: Actually send email via SES/SMTP here
        // await EmailService.send(...)

        const comm = await VendorCommModel.create(data);
        return successResponse(res, comm, 'Communication sent successfully', 201);
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    listCommunications,
    sendCommunication
};
