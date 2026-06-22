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

const activityRoutes = require('./routes/activityRoutes');
app.use('/notifications/activities', activityRoutes);

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

        subscribeToSubject('ORGANIZATION_CREATED', async (data) => {
            console.log('Received ORGANIZATION_CREATED event:', data);
            try {
                // data: { user_email, full_name, org_name, total_count, gstin }
                const { sendOrganizationCreatedEmail } = require('./services/emailService');
                await sendOrganizationCreatedEmail(data.user_email, data.full_name, data.org_name, data.gstin);
                console.log(`Organization created email sent to ${data.user_email}`);
            } catch (error) {
                console.error('Failed to send organization created email:', error);
            }
        });

        subscribeToSubject('USER_INVITED', async (data) => {
            console.log('Received USER_INVITED event:', data);
            try {
                // data: { email, user_name, inviter_name, tenant_name, org_names, role, invite_link, is_existing_user }
                const { sendUserInviteEmail } = require('./services/emailService');
                await sendUserInviteEmail(data.email, data.user_name, data.inviter_name, data.tenant_name, data.org_names, data.role, data.invite_link, data.is_existing_user);
                console.log(`Invitation email sent to ${data.email}`);
            } catch (error) {
                console.error('Failed to send invitation email:', error);
            }
        });

        subscribeToSubject('USER_ADDED_TO_ORG', async (data) => {
            console.log('Received USER_ADDED_TO_ORG event:', data);
            try {
                // data: { email, user_name, inviter_name, tenant_name, org_names, role, login_link }
                const { sendUserAddedToOrgEmail } = require('./services/emailService');
                await sendUserAddedToOrgEmail(data.email, data.user_name, data.inviter_name, data.tenant_name, data.org_names, data.role, data.login_link);
                console.log(`User added to org email sent to ${data.email}`);
            } catch (error) {
                console.error('Failed to send user added to org email:', error);
            }
        });

        subscribeToSubject('PASSWORD_RESET_REQUESTED', async (data) => {
            console.log('Received PASSWORD_RESET_REQUESTED event:', data);
            try {
                // data: { email, full_name, otp }
                const { sendPasswordResetEmail } = require('./services/emailService');
                await sendPasswordResetEmail(data.email, data.full_name, data.otp);
                console.log(`Password reset email sent to ${data.email}`);
            } catch (error) {
                console.error('Failed to send password reset email:', error);
            }
        });

        subscribeToSubject('SUPPLIER_MAIL_REQUESTED', async (data) => {
            console.log('Received SUPPLIER_MAIL_REQUESTED event:', data);
            try {
                // data: { to, subject, body }
                const { sendSupplierMail } = require('./services/emailService');
                await sendSupplierMail(data.to, data.subject, data.body);
                console.log(`Supplier mail sent to ${data.to} via MailHog`);
            } catch (error) {
                console.error('Failed to send supplier mail:', error);
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
