const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectNats } = require('./nats/natsClient');
const jsonImportRoutes = require('./routes/jsonImportRoutes');
const { errorHandler } = require('../../shared/src/utils/responseHandler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3007;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'json-import-service' });
});

// Routes
app.use('/json-import', jsonImportRoutes);

// Error Handler
app.use(errorHandler);

// Start Server
const startServer = async () => {
    app.listen(PORT, () => {
        console.log(`JSON Import Service running on port ${PORT}`);
    });

    try {
        await connectNats();
    } catch (error) {
        console.warn('Warning: NATS connection failed at startup.', error.message);
    }
};

startServer();
