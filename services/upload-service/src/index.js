const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectNats } = require('./nats/natsClient');
const uploadRoutes = require('./routes/uploadRoutes');
const gstr2bRoutes = require('./routes/gstr2bRoutes');
const gstrImportRoutes = require('./routes/gstrImportRoutes');
const bookImportRoutes = require('./routes/bookImportRoutes');
const bookImportInternalRoutes = require('./routes/bookImportInternalRoutes');
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
app.use('/gst-import', gstrImportRoutes);

// Internal connector route (service-to-service only — not exposed via Traefik)
app.use('/book-import/internal', bookImportInternalRoutes);

// Error Handler
app.use(errorHandler);

// Start Server
const startServer = async () => {
    // Start HTTP server first regardless of NATS status
    app.listen(PORT, () => {
        console.log(`Upload Service running on port ${PORT}`);
    });

    // Connect to NATS in background (non-fatal)
    try {
        await connectNats();
    } catch (error) {
        console.warn('Warning: NATS connection failed at startup. File uploads will work but event publishing will be disabled until NATS reconnects.', error.message);
    }
};

startServer();
