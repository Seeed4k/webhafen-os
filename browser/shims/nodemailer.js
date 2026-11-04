// Demo: E-Mails werden nicht verschickt, sondern im Demo-Postausgang gesammelt
export default { createTransport: () => ({ sendMail: async (m) => ({ message: JSON.stringify(m), messageId: 'demo-' + Date.now() }) }) };
