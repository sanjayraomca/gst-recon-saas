require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNATS } = require('./config/nats'); // Will create this next
const db = require('../../shared/src/db/connection'); // Use shared DB connection

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
app.use('/notices', require('./routes/noticeRoutes'));
app.use('/vendor-communications', require('./routes/vendorCommRoutes'));


app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'workspace-service' });
});

const startServer = async () => {
    try {
        await connectNATS();
        app.listen(PORT, () => {
            console.log(`Workspace Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Workspace Service:', error);
        process.exit(1);
    }
};

startServer();
