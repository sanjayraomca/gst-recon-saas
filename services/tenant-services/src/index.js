require('dotenv').config();
const express = require('express');
const { connectNats } = require('../../shared/src/nats/client'); // Relative path to shared
const authRoutes = require('./routes/authRoutes');
const tenantRoutes = require('./routes/tenantRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'Tenant Service is running' });
});

// Start Server
const start = async () => {
    try {
        await connectNats();

        // Initialize GSTIN event subscriber
        const { setupGstinEventSubscriber } = require('./events/gstinEventHandler');
        setupGstinEventSubscriber();

        app.listen(PORT, () => {
            console.log(`Tenant Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Tenant Service:', error);
        process.exit(1);
    }
};

start();
