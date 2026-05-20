require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3008;

app.use(cors());
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'external-api-service' });
});

// ─── GST API Routes ──────────────────────────────────────────
app.use('/ext/gst', require('./gst-api/routes/gstRoutes'));

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found.` });
});

// ─── Global Error Handler ────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Global Error]', err.message);
    res.status(500).json({ success: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
    console.log(`[external-api-service] Running on port ${PORT}`);
    console.log(`[external-api-service] White Book Base URL: ${process.env.WHITEBOOK_BASE_URL}`);
});
