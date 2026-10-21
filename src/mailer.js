// Envío de correos por SMTP (reporte semanal y recuperación de contraseña).
let transport = null;

const isMailConfigured = () => Boolean(process.env.SMTP_HOST);

function getTransport() {
  if (!isMailConfigured()) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transport;
}

async function sendMail(message) {
  const t = getTransport();
  if (!t) throw new Error('El envío de correos no está configurado (SMTP).');
  return t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...message });
}

module.exports = { isMailConfigured, sendMail };
