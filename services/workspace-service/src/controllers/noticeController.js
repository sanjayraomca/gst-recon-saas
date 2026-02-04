const NoticeModel = require('../models/noticeModel');
const DefensePackModel = require('../models/defensePackModel');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

const listNotices = async (req, res) => {
    try {
        const { page = 1, page_size = 20, ...filters } = req.query;
        filters.workspace_id = req.headers['x-workspace-id']; // Assuming middleware sets this or valid check

        if (!filters.workspace_id) {
            return errorResponse(res, { message: 'Workspace ID required' }, 400);
        }

        const notices = await NoticeModel.findAll(filters, { page, page_size });
        return successResponse(res, notices, 'Notices fetched successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const createNotice = async (req, res) => {
    try {
        const data = req.body;
        data.workspace_id = req.headers['x-workspace-id'];
        data.created_by = req.user.id; // from auth middleware

        if (!data.workspace_id) return errorResponse(res, { message: 'Workspace ID required' }, 400);

        const notice = await NoticeModel.create(data);
        return successResponse(res, notice, 'Notice created successfully', 201);
    } catch (error) {
        return errorResponse(res, error);
    }
};

const getNotice = async (req, res) => {
    try {
        const { notice_id } = req.params;
        const notice = await NoticeModel.findById(notice_id);

        if (!notice) return errorResponse(res, { message: 'Notice not found' }, 404);

        // Fetch defense pack if exists
        const defensePack = await DefensePackModel.findByNoticeId(notice_id);

        return successResponse(res, { ...notice, defense_pack: defensePack }, 'Notice fetched successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const generateDefensePack = async (req, res) => {
    try {
        const { notice_id } = req.params;
        const data = req.body;
        data.notice_id = notice_id;
        data.workspace_id = req.headers['x-workspace-id'];

        // Check if exists update, else create
        let defensePack = await DefensePackModel.findByNoticeId(notice_id);

        if (defensePack) {
            defensePack = await DefensePackModel.update(defensePack.id, {
                ...data,
                updated_at: new Date()
            });
        } else {
            defensePack = await DefensePackModel.create({
                ...data,
                created_by: req.user.id
            });
        }

        return successResponse(res, defensePack, 'Defense pack generated/updated successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

const submitResponse = async (req, res) => {
    try {
        const { notice_id } = req.params;
        const data = req.body; // { response_date, response_arn, ... }

        // Update notice status
        const updatedNotice = await NoticeModel.update(notice_id, {
            ...data,
            status: 'REPLIED', // or from body
            updated_at: new Date()
        });

        return successResponse(res, updatedNotice, 'Response submitted successfully');
    } catch (error) {
        return errorResponse(res, error);
    }
};

module.exports = {
    listNotices,
    createNotice,
    getNotice,
    generateDefensePack,
    submitResponse
};
