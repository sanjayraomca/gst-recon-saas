const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailhog',
    port: process.env.SMTP_PORT || 1025,
    secure: false, // true for 465, false for other ports
    auth: null // MailHog doesn't require auth
});

const sendWelcomeEmail = async (email, fullName, tenantCode) => {
    // Capitalize first letter of each word in the name
    const formattedName = fullName
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const mailOptions = {
        from: '"The ADESK Team" <no-reply@gsttool.local>',
        to: email,
        subject: `Welcome to ADESK GST | Your Account is Ready (Tenant: ${tenantCode})`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <p>Dear ${formattedName},</p>
                <br>
                <p>Welcome to ADESK GST. Your registration is complete, and your dedicated tenant environment has been successfully provisioned.</p>
                <p>To get started, please use your unique Tenant Code for all administrative inquiries:</p>
                <p><strong>Tenant Code:</strong> ${tenantCode}</p>
                <p><strong>Full Name:</strong> ${formattedName}</p>
                <p><strong>Email:</strong> ${email}</p>
                <br>
                <p>You can now access your workspace to manage reconciliations, track GST filings, and streamline your tax workflows.</p>
                <br>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Login to ADESK GST</a>
                <br><br>
                <p>If you require technical assistance or have questions regarding your setup, please contact our support team.</p>
                <br>
                <p>Best regards,</p>
                <p>The ADESK Team</p>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

const sendOrganizationCreatedEmail = async (email, fullName = 'User', orgName, gstin) => {
    // Capitalize first letter of each word in the name
    const formattedName = (fullName || 'User')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const mailOptions = {
        from: '"The ADESK Team" <no-reply@gsttool.local>',
        to: email,
        subject: 'New Organization Successfully Provisioned | ADESK GST',
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <p>Dear ${formattedName},</p>
                <br>
                <p>We are pleased to confirm that your new organization has been successfully established within the ADESK GST ecosystem.</p>
                <br>
                <p><strong>Organization Details:</strong></p>
                <br>
                <p><strong>Organization Name:</strong> ${orgName}</p>
                <p><strong>GSTIN:</strong> ${gstin}</p>
                <br>
                <p>Your administrative privileges for this entity are now active. You may begin configuring your organizational settings, managing GSTIN profiles, and inviting team members to your workspace.</p>
                <br>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Launch ADESK Dashboard</a>
                <br><br>
                <p>If this organization was created in error, or if you require assistance with your workspace configuration, please contact our administrative support team.</p>
                <br>
                <p>Best regards,</p>
                <p>The ADESK Team</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

const sendUserInviteEmail = async (email, userName, inviterName, tenantName, orgNames, role, inviteLink, isExistingUser = false) => {
    // Check if orgNames is array, if so join them
    const orgsList = Array.isArray(orgNames) ? orgNames.join(', ') : orgNames;
    const formattedUserName = (userName || 'User')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const formattedTenantName = (tenantName || 'Organization')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const buttonText = isExistingUser ? 'Accept Invitation' : 'Accept Invitation & Complete Setup';
    const bodyText = isExistingUser
        ? `You have been invited to join the <strong>${formattedTenantName}</strong> workspace. Since you already have an account, you can simply click the button below to accept the invitation and gain access to the specified organizations.`
        : `As an ${role}, you will have the authority to manage tax reconciliations, oversee organizational configurations, and coordinate team workflows. To finalize your onboarding and activate your administrative dashboard, please select the button below:`;

    const mailOptions = {
        from: '"The ADESK Team" <no-reply@gsttool.local>',
        to: email,
        subject: `Invitation to Join Workspace: ${formattedTenantName} | ADESK GST`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <p>Dear ${formattedUserName},</p>
                
                <p>${formattedTenantName} has invited you to join organization within the ADESK GST platform</p>
            
                <p>You have been allowed to access below organizations:</p>
                
                <p><strong>Organizations:</strong> ${orgsList}</p>
                <p><strong>Your Role as:</strong> ${role}</p>
                <br>
                <p>${bodyText}</p>
                <br>
                <a href="${inviteLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${buttonText}</a>
                <br><br>
                <p><strong>Security Note:</strong> For your protection, this invitation link is unique to your email address. If you were not expecting this request, no further action is required; the invitation will expire automatically.</p>
                <br>
                <p>Welcome to the team.</p>
                <br>
                <p>Best regards,</p>
                <p>The ADESK Team</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

const sendPasswordResetEmail = async (email, fullName, otp) => {
    const formattedName = (fullName || 'User')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const mailOptions = {
        from: '"The ADESK Team" <no-reply@gsttool.local>',
        to: email,
        subject: 'Password Reset Request | ADESK GST',
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <p>Dear ${formattedName},</p>
                <br>
                <p>We received a request to reset your password for your ADESK GST account.</p>
                <p>Use the following One-Time Password (OTP) to reset your password:</p>
                <br>
                <h2 style="color: #007bff; letter-spacing: 5px;">${otp}</h2>
                <br>
                <p>This OTP is valid for 15 minutes.</p>
                <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
                <br>
                <p>Best regards,</p>
                <p>The ADESK Team</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

const sendUserAddedToOrgEmail = async (email, userName, inviterName, tenantName, orgNames, role, loginLink) => {
    const orgsList = Array.isArray(orgNames) ? orgNames.join(', ') : orgNames;
    const formattedUserName = (userName || 'User')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const formattedTenantName = (tenantName || 'Organization')
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const mailOptions = {
        from: '"The ADESK Team" <no-reply@gsttool.local>',
        to: email,
        subject: `You've been added to ${formattedTenantName} | ADESK GST`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <p>Dear ${formattedUserName},</p>
                <p>You have been added to the <strong>${formattedTenantName}</strong> tenant on the ADESK GST platform by ${inviterName}.</p>
                <p>You now have access to the following organizations:</p>
                <p><strong>Organizations:</strong> ${orgsList}</p>
                <p><strong>Role:</strong> ${role}</p>
                <br>
                <p>You can now log in to your account and start collaborating.</p>
                <br>
                <a href="${loginLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Login to Your Account</a>
                <br><br>
                <p>Best regards,</p>
                <p>The ADESK Team</p>
            </div>
        `
    };
    return transporter.sendMail(mailOptions);
};

const sendSupplierMail = async (to, subject, htmlBody) => {
    const mailOptions = {
        from: '"ADESK GST Support" <no-reply@gsttool.local>',
        to: to,
        subject: subject,
        html: htmlBody // SupplierMailComposer sends standard HTML or formatted text
    };
    return transporter.sendMail(mailOptions);
};

module.exports = {
    sendWelcomeEmail,
    sendOrganizationCreatedEmail,
    sendUserInviteEmail,
    sendUserAddedToOrgEmail,
    sendPasswordResetEmail,
    sendSupplierMail
};
