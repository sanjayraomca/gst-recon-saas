const db = require('./db/connection');
const nats = require('./nats/client');
const authMiddleware = require('./middleware/authMiddleware');
const responseHandler = require('./utils/responseHandler');

module.exports = {
    db,
    nats,
    authMiddleware,
    responseHandler
};
