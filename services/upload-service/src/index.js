const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectNats } = require('./nats/natsClient');
const uploadRoutes = require('./routes/uploadRoutes');
const gstr2bRoutes = require('./routes/gstr2bRoutes');
const { errorHandler } = require('../../shared/src/utils/responseHandler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'upload-service' });
});

// Routes
app.use('/uploads', uploadRoutes);
app.use('/gst-import/gstr2b', gstr2bRoutes);

// Error Handler
app.use(errorHandler);

// Start Server
const startServer = async () => {
    try {
        await connectNats();
        app.listen(PORT, () => {
            console.log(`Upload Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Upload Service:', error);
        process.exit(1);
    }
};

startServer();
