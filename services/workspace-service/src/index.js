require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNats } = require('../../shared/src/nats/client');
const knex = require('../../shared/src/db/connection'); // Use shared DB connection

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Routes
app.use('/workspaces', require('./routes/workspaceRoutes'));
app.use('/purchase-invoices', require('./routes/purchaseInvoiceRoutes'));
app.use('/gstr2b-invoices', require('./routes/gstr2bInvoiceRoutes'));
app.use('/reconciliation', require('./routes/reconciliationRoutes'));
app.use('/', require('./routes/itcRoutes')); // mounts /itc-decisions and /itc-reversals
app.use('/rcm-liabilities', require('./routes/rcmRoutes'));
app.use('/states', require('./routes/stateRoutes')); // State lookup routes
app.use('/book-data', require('./routes/bookDataRoutes')); // Book data listing (CN, DN, Sales, Purchase)
app.use('/suppliers', require('./routes/supplierRoutes')); // Supplier listing aggregated from all sources



app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'workspace-service' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

const startServer = async () => {
    try {
        await connectNats();
        app.listen(PORT, () => {
            console.log(`Workspace Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Workspace Service:', error);
        process.exit(1);
    }
};

startServer();
