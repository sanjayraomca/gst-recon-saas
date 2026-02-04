require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNATS } = require('./config/nats');
// Use relative path to shared module (Note: ../../../shared from src/index.js is incorrect if running from root context, but inside container simpler structure?)
// WAIT: Inside container structure is /app/services/gstn-service/src/index.js
// Shared is at /app/services/shared
// So path is ../../../shared/src/db/connection
const db = require('../../shared/src/db/connection');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// Routes
app.use('/gstins', require('./routes/gstinRoutes'));
app.use('/suppliers', require('./routes/supplierRoutes'));

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'gstn-service' });
});

const startServer = async () => {
    try {
        await connectNATS();
        app.listen(PORT, () => {
            console.log(`GSTN Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start GSTN Service:', error);
        process.exit(1);
    }
};

startServer();
