const successResponse = (res, data, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
};

const errorResponse = (res, error, statusCode = 500) => {
    console.error('Error:', error);
    const message = typeof error === 'string' ? error : (error.message || 'Internal Server Error');
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
