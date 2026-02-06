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

module.exports = {
    sendWelcomeEmail
};
