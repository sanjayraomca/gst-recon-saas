const successResponse = (res, data, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
};

const errorResponse = (res, error, statusCode = 500) => {
    console.error('Error:', error);

    let message = typeof error === 'string' ? error : (error.message || 'Internal Server Error');

    // Map technical errors to user-friendly messages if not already customized
    if (statusCode === 409) {
        if (message.includes('already exists') || message.includes('23505')) {
            message = 'This information already exists in our system. Please check for duplicates.';
        }
    } else if (statusCode === 401) {
        message = 'Your session has expired or is invalid. Please log in again.';
    } else if (statusCode === 403) {
        message = 'You do not have permission to perform this action.';
    } else if (statusCode === 400 && !error.isCustom) {
        message = 'Some information is missing or incorrect. Please check your input and try again.';
    } else if (statusCode === 500 || statusCode === 502) {
        message = 'Something went wrong on our end. Please try again in a few minutes.';
    }

    return res.status(statusCode).json({
        success: false,
        error: message
    });
};

const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
};

module.exports = {
    successResponse,
    errorResponse,
    errorHandler
};
