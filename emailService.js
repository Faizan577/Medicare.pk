const nodemailer = require('nodemailer');

// Create a transporter using Gmail (You can use any SMTP service)
// IMPORTANT: To make this work, replace 'user' and 'pass' with your real Gmail and App Password
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'faizanumer316@gmail.com', // e.g., myclinic@gmail.com
        pass: ' zhkx ipcb ocdq uvdw'     // Go to Google Account -> Security -> App Passwords to generate this
    }
});

function sendEmail(toEmail, subject, textContent) {
    if (!toEmail) return;

    // Log to terminal (Simulator Mode)
    console.log(`\n======================================`);
    console.log(`📧 EMAIL NOTIFICATION DISPATCHED`);
    console.log(`======================================`);
    console.log(`To: ${toEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message: ${textContent}`);
    console.log(`======================================\n`);

    const mailOptions = {
        from: 'MediCare System faizanumer316@gmail.com',
        to: toEmail,
        subject: subject,
        text: textContent
    };

    // Attempt to send the actual email
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log('⚠️ [Mail System]: Real email was not sent because Gmail credentials are not configured yet in emailService.js.');
        } else {
            console.log('✅ [Mail System]: Email sent successfully to ' + toEmail);
        }
    });
}

module.exports = { sendEmail };
