require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNATS } = require('./config/nats');
const db = require('../../shared/src/db/connection');
const reportGenerator = require('./services/reportGenerator');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// Routes
app.use('/reports', require('./routes/reportRoutes'));
app.use('/analytics', require('./routes/analyticsRoutes'));

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'report-service' });
});

const startServer = async () => {
    try {
        await connectNATS();
        await reportGenerator.start();
        app.listen(PORT, () => {
            console.log(`Report Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Report Service:', error);
        process.exit(1);
    }
};

startServer();
