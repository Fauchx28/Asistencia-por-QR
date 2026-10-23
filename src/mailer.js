// Envío de correos por SMTP (reporte semanal y recuperación de contraseña).
// Con SMTP_HOST=json no se envía nada: los correos quedan en `outbox` (para pruebas).
let transport = null;
const outbox = [];

const isMailConfigured = () => Boolean(process.env.SMTP_HOST);
const isTestMode = () => process.env.SMTP_HOST === 'json';

function getTransport() {
  if (!isMailConfigured()) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = isTestMode()
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
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
  const info = await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER || 'asistencia@localhost', ...message });
  if (isTestMode()) outbox.push(JSON.parse(info.message));
  return info;
}

module.exports = { isMailConfigured, sendMail, outbox };
