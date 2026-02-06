require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectNats, subscribeToSubject } = require('../../shared/src/nats/client');
const { sendWelcomeEmail } = require('./services/emailService');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'UP', service: 'notification-service' });
});

const startServer = async () => {
    try {
        await connectNats();

        console.log('Subscribing to NATS subjects...');
        subscribeToSubject('TENANT_REGISTERED', async (data) => {
            console.log('Received TENANT_REGISTERED event:', data);
            try {
                await sendWelcomeEmail(data.email, data.full_name, data.tenant_code);
                console.log(`Welcome email sent to ${data.email}`);
            } catch (error) {
                console.error('Failed to send welcome email:', error);
            }
        });

        app.listen(PORT, () => {
            console.log(`Notification Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start Notification Service:', error);
        process.exit(1);
    }
};

startServer();
