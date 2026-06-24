// smsService.js
// Mock SMS Service for MediCare
// To send actual SMS, integrate with Twilio or similar service here.

function sendSMS(phone, message) {
    if (!phone) return;
    
    console.log(`\n======================================`);
    console.log(`📱 SMS NOTIFICATION DISPATCHED`);
    console.log(`======================================`);
    console.log(`To: ${phone}`);
    console.log(`Message: ${message}`);
    console.log(`======================================\n`);
    
    // Example Twilio Implementation (Uncomment and install twilio to use):
    /*
    const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
    }).then(msg => console.log('Twilio SMS sent: ' + msg.sid))
      .catch(err => console.error('Twilio Error:', err));
    */
}

module.exports = { sendSMS };
