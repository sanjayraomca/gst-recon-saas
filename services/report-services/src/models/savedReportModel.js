const db = require('../../../shared/src/db/connection');

/**
 * Saved Report Model
 * Matches saved_reports table schema
 */
class SavedReportModel {
    /**
     * Get all reports with filters and pagination
     */
    static async getAll(workspaceId, filters = {}, pagination = {}) {
        const {
            report_type,
            status,
            date_from,
            date_to
        } = filters;

        const { page = 1, page_size = 50 } = pagination;
        const offset = (page - 1) * page_size;

        let query = db('saved_reports')
            .where({ workspace_id: workspaceId });

        // Apply filters
        if (report_type) query = query.where({ report_type });
        if (status) query = query.where({ generation_status: status }); // DB column is generation_status
        if (date_from) query = query.where('created_at', '>=', date_from);
        if (date_to) query = query.where('created_at', '<=', date_to);

        // Get total count
        const countQuery = query.clone();
        const [{ count }] = await countQuery.count('* as count');

        // Get paginated results
        const reports = await query
            .orderBy('created_at', 'desc')
            .limit(page_size)
            .offset(offset);

        // Map DB columns back to API response structure
        const mappedReports = reports.map(r => ({
            ...r,
            status: r.generation_status,
            file_url: r.report_config ? r.report_config.file_url : null,
            parameters: r.filters_applied
        }));

        return {
            data: mappedReports,
            pagination: {
                page: parseInt(page),
                page_size: parseInt(page_size),
                total: parseInt(count),
                total_pages: Math.ceil(count / page_size)
            }
        };
    }

    /**
     * Get single report by ID
     */
    static async getById(workspaceId, id) {
        const report = await db('saved_reports')
            .where({
                id,
                workspace_id: workspaceId
            })
            .first();

        if (report) {
            report.status = report.generation_status;
            report.file_url = report.report_config ? report.report_config.file_url : null;
            report.parameters = report.filters_applied;
        }
        return report;
    }

    /**
     * Create new report entry
     */
    static async create(workspaceId, data) {
        // Store scheduling and format details in report_config if not present in schema
        const config = {
            ...(data.report_config || {}),
            is_scheduled: data.is_scheduled || false,
            schedule_frequency: data.schedule_frequency,
            schedule_day: data.schedule_day,
            schedule_time: data.schedule_time,
            recipients: data.recipients,
            format: data.format
        };

        const [report] = await db('saved_reports')
            .insert({
                id: db.raw('uuid_generate_v4()'),
                workspace_id: workspaceId,
                report_type: data.report_type,
                report_name: data.report_name || `${data.report_type} - ${new Date().toISOString()}`,
                report_config: config,
                filters_applied: data.report_config && data.report_config.filters ? data.report_config.filters : (data.parameters || {}),
                generation_status: 'CREATED', // Initial status for a saved config
                created_at: db.fn.now(),
                updated_at: db.fn.now()
            })
            .returning('*');

        // Map for response
        report.status = report.generation_status;
        return report;
    }

    /**
     * Update report status and file URL
     */
    static async update(workspaceId, id, updateData) {
        const current = await db('saved_reports')
            .select('report_config')
            .where({ id, workspace_id: workspaceId })
            .first();

        if (!current) return null;

        const newConfig = { ...current.report_config };

        const updateFields = {};

        if (updateData.status) {
            updateFields.generation_status = updateData.status;
        }

        if (updateData.file_url) {
            newConfig.file_url = updateData.file_url;
            updateFields.report_config = newConfig;
        }

        if (updateData.error_message) {
            newConfig.error_message = updateData.error_message;
            updateFields.report_config = newConfig;
        }

        updateFields.updated_at = db.fn.now();
        if (updateData.status === 'COMPLETED') {
            updateFields.last_generated_at = db.fn.now();
        }

        const [report] = await db('saved_reports')
            .where({
                id,
                workspace_id: workspaceId
            })
            .update(updateFields)
            .returning('*');

        if (report) {
            report.status = report.generation_status;
            report.file_url = report.report_config ? report.report_config.file_url : null;
        }

        return report;
    }
}

module.exports = SavedReportModel;
