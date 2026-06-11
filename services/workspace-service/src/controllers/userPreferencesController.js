const knex = require('../../../shared/src/db/connection');
const { successResponse, errorResponse } = require('../../../shared/src/utils/responseHandler');

// ==========================================
// RECENT VIEWS
// ==========================================

const addRecentView = async (req, res) => {
    try {
        const { tenant_id, workspace_id, title, page_url, t_extra_info } = req.body;
        const user_id = req.user.db_id || req.user.id;

        if (!tenant_id || !workspace_id || !page_url) {
            return errorResponse(res, 'tenant_id, workspace_id, and page_url are required', 400);
        }

        // Check if the same URL is already in recent views for this user in this workspace
        const existingView = await knex('recent_view')
            .where({
                tenant_id,
                workspace_id,
                user_id,
                page_url
            })
            .first();

        let result;
        if (existingView) {
            // Update the updated_at to bring it to the top
            [result] = await knex('recent_view')
                .where({ id: existingView.id })
                .update({
                    title: title || existingView.title,
                    t_extra_info: t_extra_info || existingView.t_extra_info,
                    updated_at: new Date()
                })
                .returning('*');
        } else {
            // Insert new recent view
            [result] = await knex('recent_view')
                .insert({
                    tenant_id,
                    workspace_id,
                    user_id,
                    title,
                    page_url,
                    t_extra_info,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .returning('*');
        }

        return successResponse(res, result, 'Recent view added successfully', 201);
    } catch (error) {
        console.error('Error adding recent view:', error);
        return errorResponse(res, error);
    }
};

const getRecentViews = async (req, res) => {
    try {
        const { tenant_id, workspace_id, limit = 2 } = req.query;
        const user_id = req.user.db_id || req.user.id;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'tenant_id and workspace_id are required in query params', 400);
        }

        const recentViews = await knex('recent_view')
            .where({
                tenant_id,
                workspace_id,
                user_id
            })
            .orderBy('updated_at', 'desc')
            .limit(parseInt(limit));

        return successResponse(res, recentViews, 'Recent views retrieved successfully');
    } catch (error) {
        console.error('Error fetching recent views:', error);
        return errorResponse(res, error);
    }
};

// ==========================================
// FAVOURITES
// ==========================================

const addFavourite = async (req, res) => {
    try {
        const { tenant_id, workspace_id, title, page_url, t_extra_info } = req.body;
        const user_id = req.user.db_id || req.user.id;

        if (!tenant_id || !workspace_id || !page_url) {
            return errorResponse(res, 'tenant_id, workspace_id, and page_url are required', 400);
        }

        // Check if it already exists
        const existingFav = await knex('favourite_master')
            .where({
                tenant_id,
                workspace_id,
                user_id,
                page_url
            })
            .first();

        if (existingFav) {
            return errorResponse(res, 'This page is already in your favourites', 409);
        }

        const [result] = await knex('favourite_master')
            .insert({
                tenant_id,
                workspace_id,
                user_id,
                title,
                page_url,
                t_extra_info,
                created_at: new Date(),
                updated_at: new Date()
            })
            .returning('*');

        return successResponse(res, result, 'Favourite added successfully', 201);
    } catch (error) {
        console.error('Error adding favourite:', error);
        return errorResponse(res, error);
    }
};

const getFavourites = async (req, res) => {
    try {
        const { tenant_id, workspace_id } = req.query;
        const user_id = req.user.db_id || req.user.id;

        if (!tenant_id || !workspace_id) {
            return errorResponse(res, 'tenant_id and workspace_id are required in query params', 400);
        }

        const favourites = await knex('favourite_master')
            .where({
                tenant_id,
                workspace_id,
                user_id
            })
            .orderBy('created_at', 'desc');

        return successResponse(res, favourites, 'Favourites retrieved successfully');
    } catch (error) {
        console.error('Error fetching favourites:', error);
        return errorResponse(res, error);
    }
};

const removeFavourite = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.db_id || req.user.id;

        const deletedCount = await knex('favourite_master')
            .where({
                id,
                user_id // Ensure they only delete their own favourite
            })
            .del();

        if (deletedCount === 0) {
            return errorResponse(res, 'Favourite not found or not authorized', 404);
        }

        return successResponse(res, null, 'Favourite removed successfully');
    } catch (error) {
        console.error('Error removing favourite:', error);
        return errorResponse(res, error);
    }
};

module.exports = {
    addRecentView,
    getRecentViews,
    addFavourite,
    getFavourites,
    removeFavourite
};
