const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailhog',
    port: process.env.SMTP_PORT || 1025,
    secure: false, // true for 465, false for other ports
    auth: null // MailHog doesn't require auth
});

const sendWelcomeEmail = async (email, fullName, tenantCode) => {
    const mailOptions = {
        from: '"GST Recon Tool" <no-reply@gsttool.local>',
        to: email,
        subject: 'Welcome to GST Reconciliation Tool',
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Welcome, ${fullName}!</h2>
                <p>Thank you for registering with GST Reconciliation Tool.</p>
                <p>Your tenant account has been successfully created.</p>
                <p><strong>Tenant Code:</strong> ${tenantCode}</p>
                <br>
                <p>You can now login to your dashboard and start managing your reconciliations.</p>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Login to Dashboard</a>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

const sendOrganizationCreatedEmail = async (email, fullName, orgName, totalOrgs) => {
    const mailOptions = {
        from: '"GST Recon Tool" <no-reply@gsttool.local>',
        to: email,
        subject: `New Organization Created: ${orgName}`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Organization Created Successfully</h2>
                <p>Hello ${fullName},</p>
                <p>You have successfully created a new organization:</p>
                <p><strong>Name:</strong> ${orgName}</p>
                <br>
                <p>You now manage a total of <strong>${totalOrgs}</strong> organization(s).</p>
                <br>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Dashboard</a>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

const sendUserInviteEmail = async (email, inviterName, orgName, role, inviteLink) => {
    const mailOptions = {
        from: '"GST Recon Tool" <no-reply@gsttool.local>',
        to: email,
        subject: `Invitation to join ${orgName}`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>You've been invited!</h2>
                <p>Hello,</p>
                <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong>.</p>
                <p>Please click the button below to accept the invitation and set up your account.</p>
                <br>
                <a href="${inviteLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Accept Invitation</a>
                <br><br>
                <p><small>If you did not expect this invitation, you can safely ignore this email.</small></p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

module.exports = {
    sendWelcomeEmail,
    sendOrganizationCreatedEmail,
    sendUserInviteEmail
};
