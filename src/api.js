// Rutas de la API REST (/api/...).
const express = require('express');
const multer = require('multer');
const { HttpError } = require('./util');
const { qrPng, writeCardsPdf, writeQrZip, safeFile } = require('./services/qr');
const { importStudents } = require('./services/importer');
const { clientIp } = require('./auth');
const { isMailConfigured, sendMail } = require('./mailer');
const { backupNow, listBackups } = require('./backup');

// Administradores de la plataforma: correos en ADMIN_EMAILS separados por coma.
const isAdmin = (teacher) => Boolean(teacher) && String(process.env.ADMIN_EMAILS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(String(teacher.email).toLowerCase());
const publicTeacher = (t) => (t ? { id: t.id, name: t.name, email: t.email, is_admin: isAdmin(t) } : null);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Envuelve handlers async para que los errores lleguen al manejador central.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApi({ db, auth, courses, attendance, reports }) {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));

  // Protección básica contra peticiones de otros sitios (CSRF): el Origin debe ser este mismo servidor.
  r.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.headers.origin) return next();
    let host = '';
    try { host = new URL(req.headers.origin).host; } catch { /* origen inválido */ }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (process.env.APP_URL) { try { allowed.push(new URL(process.env.APP_URL).host); } catch { /* APP_URL inválida */ } }
    if (!allowed.includes(host)) return res.status(403).json({ error: 'Origen no permitido.' });
    next();
  });

  const resetAvailable = () => isMailConfigured() && Boolean(process.env.APP_URL);

  // --- Autenticación y sesiones ---
  r.get('/auth/me', (req, res) => res.json({
    teacher: publicTeacher(req.teacher),
    config: {
      allow_registration: process.env.ALLOW_REGISTRATION !== 'false',
      registration_code_required: auth.registrationRequiresCode(),
      password_reset_available: resetAvailable(),
      report_auto_send: process.env.REPORT_AUTO_SEND !== 'false',
      report_day: Number(process.env.REPORT_DAY ?? 5),
      report_time: process.env.REPORT_TIME || '16:00',
      mail_configured: isMailConfigured(),
      timezone: process.env.APP_TIMEZONE || 'America/Bogota',
      org_name: process.env.ORG_NAME || '',
      privacy_contact: process.env.PRIVACY_CONTACT || ''
    }
  }));
  r.post('/auth/register', h((req, res) => {
    const body = req.body || {};
    const teacher = auth.register(body);
    auth.startSession(req, res, teacher.id, { remember: Boolean(body.remember) });
    res.status(201).json({ teacher: publicTeacher(teacher), first_time: true });
  }));
  r.post('/auth/login', h((req, res) => {
    const body = req.body || {};
    const teacher = auth.login(body, clientIp(req));
    auth.startSession(req, res, teacher.id, { remember: Boolean(body.remember) });
    res.json({ teacher: publicTeacher(teacher) });
  }));
  r.post('/auth/logout', h((req, res) => {
    auth.endSession(req, res);
    res.json({ ok: true });
  }));

  // Siempre responde lo mismo, exista o no el correo, para no revelar quién tiene cuenta.
  r.post('/auth/forgot', h(async (req, res) => {
    if (!resetAvailable()) throw new HttpError(503, 'La recuperación por correo no está configurada. Pide ayuda al administrador.');
    const result = auth.createResetToken((req.body || {}).email, clientIp(req));
    if (result) {
      const link = `${process.env.APP_URL.replace(/\/$/, '')}/#/restablecer?token=${encodeURIComponent(result.token)}`;
      sendMail({
        to: result.teacher.email,
        subject: 'Restablece tu contraseña de Asistencia QR',
        text: `Hola, ${result.teacher.name}:\n\nRecibimos una solicitud para restablecer tu contraseña. Abre este enlace (vence en 1 hora):\n\n${link}\n\nSi no fuiste tú, ignora este correo; tu contraseña no cambiará.`
      }).catch((err) => console.error('[recuperación] no se pudo enviar el correo:', err.message));
    }
    res.json({ ok: true });
  }));
  r.get('/auth/reset/check', h((req, res) => { auth.checkResetToken(req.query.token); res.json({ ok: true }); }));
  r.post('/auth/reset', h((req, res) => {
    const teacher = auth.resetPassword(req.body || {});
    auth.startSession(req, res, teacher.id);
    res.json({ teacher: publicTeacher(teacher) });
  }));

  r.use(auth.requireTeacher);
  const tid = (req) => req.teacher.id;

  // --- Administración: copias de seguridad ---
  const requireAdmin = (req, res, next) => (isAdmin(req.teacher) ? next() : res.status(403).json({ error: 'Solo para administradores.' }));
  const backupInfo = (b) => ({ name: b.name, size: require('node:fs').statSync(b.file).size, created_at: b.mtime });
  r.get('/admin/backups', requireAdmin, h((req, res) => res.json({ backups: listBackups().map(backupInfo) })));
  r.post('/admin/backups', requireAdmin, h((req, res) => {
    const file = backupNow(db);
    res.status(201).json({ backup: backupInfo(listBackups().find((b) => b.file === file)) });
  }));
  r.get('/admin/backups/:name', requireAdmin, h((req, res) => {
    const b = listBackups().find((x) => x.name === req.params.name); // solo nombres existentes: evita rutas arbitrarias
    if (!b) throw new HttpError(404, 'Esa copia no existe.');
    res.set('Content-Disposition', `attachment; filename="${b.name}"`).type('application/octet-stream');
    require('node:fs').createReadStream(b.file).pipe(res);
  }));

  // --- Mi cuenta ---
  r.get('/account', h((req, res) => res.json(auth.getAccount(tid(req), req.sessionId))));
  r.put('/account', h((req, res) => res.json({ teacher: publicTeacher(auth.updateProfile(tid(req), req.body || {})) })));
  r.put('/account/password', h((req, res) => res.json(auth.changePassword(tid(req), req.sessionId, req.body || {}))));
  r.post('/account/sessions/close-others', h((req, res) => res.json({ closed: auth.revokeOtherSessions(tid(req), req.sessionId) })));
  r.delete('/account', h((req, res) => {
    auth.deleteAccount(tid(req), req.body || {});
    auth.endSession(req, res);
    res.json({ ok: true });
  }));
  r.delete('/account/sessions/:sessionId', h((req, res) => {
    if (req.params.sessionId === req.sessionId) throw new HttpError(400, 'Para cerrar esta sesión usa "Cerrar sesión".');
    auth.revokeSession(tid(req), req.params.sessionId);
    res.json({ ok: true });
  }));

  // --- Cursos ---
  r.get('/courses', h((req, res) => res.json({ courses: courses.listCourses(tid(req)) })));
  r.post('/courses', h((req, res) => res.status(201).json({ course: courses.createCourse(tid(req), req.body || {}) })));
  r.get('/courses/:id', h((req, res) => res.json({ course: courses.getCourse(tid(req), req.params.id) })));
  r.put('/courses/:id', h((req, res) => res.json({ course: courses.updateCourse(tid(req), req.params.id, req.body || {}) })));
  r.delete('/courses/:id', h((req, res) => { courses.deleteCourse(tid(req), req.params.id); res.json({ ok: true }); }));

  // Importar lista (Excel, CSV, foto o texto). Solo devuelve los nombres para revisarlos; no guarda nada.
  r.post('/import', upload.single('file'), h(async (req, res) => {
    const f = req.file;
    const result = await importStudents({
      buffer: f && f.buffer, filename: f && f.originalname, mimetype: f && f.mimetype, text: req.body && req.body.text
    });
    res.json(result);
  }));

  // --- Estudiantes ---
  r.get('/courses/:id/students', h((req, res) => res.json({ students: courses.listStudents(tid(req), req.params.id) })));
  r.post('/courses/:id/students', h((req, res) => res.status(201).json({ student: courses.addStudent(tid(req), req.params.id, req.body || {}) })));
  r.put('/students/:sid', h((req, res) => res.json({ student: courses.updateStudent(tid(req), req.params.sid, req.body || {}) })));
  r.delete('/students/:sid', h((req, res) => { courses.removeStudent(tid(req), req.params.sid); res.json({ ok: true }); }));
  r.post('/students/:sid/regenerate-qr', h((req, res) => res.json({ student: courses.regenerateQr(tid(req), req.params.sid) })));

  // --- Códigos QR ---
  r.get('/students/:sid/qr.png', h(async (req, res) => {
    const s = courses.getStudent(tid(req), req.params.sid);
    res.type('png').set('Cache-Control', 'private, no-store').send(await qrPng(s.qr_token, Number(req.query.size) || 600));
  }));
  r.get('/courses/:id/qr.pdf', h(async (req, res) => {
    const c = courses.getCourse(tid(req), req.params.id);
    const students = courses.listStudents(tid(req), c.id);
    res.type('pdf').set('Content-Disposition', `attachment; filename="Carnes_QR_${safeFile(c.name)}.pdf"`);
    await writeCardsPdf(res, c, students);
  }));
  r.get('/courses/:id/qr.zip', h(async (req, res) => {
    const c = courses.getCourse(tid(req), req.params.id);
    const students = courses.listStudents(tid(req), c.id);
    res.type('zip').set('Content-Disposition', `attachment; filename="QR_${safeFile(c.name)}.zip"`);
    await writeQrZip(res, c, students);
  }));

  // --- Asistencia ---
  r.get('/courses/:id/attendance', h((req, res) => res.json(attendance.dayList(tid(req), req.params.id, req.query.date))));
  r.post('/courses/:id/attendance/scan', h((req, res) => res.json(attendance.scan(tid(req), req.params.id, (req.body || {}).token))));
  r.put('/courses/:id/attendance/:sid', h((req, res) => {
    const { date, status } = req.body || {};
    res.json(attendance.setStatus(tid(req), req.params.id, req.params.sid, date, status ?? null));
  }));
  r.post('/courses/:id/attendance/close', h((req, res) => res.json(attendance.closeDay(tid(req), req.params.id, (req.body || {}).date))));

  // --- Reportes semanales ---
  r.get('/courses/:id/week', h((req, res) => res.json(reports.weekMatrix(tid(req), req.params.id, req.query.date))));
  r.get('/courses/:id/week.xlsx', h(async (req, res) => {
    const m = reports.weekMatrix(tid(req), req.params.id, req.query.date);
    const buf = await reports.buildXlsx(m);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', `attachment; filename="${reports.fileName(m)}"`).send(buf);
  }));
  r.post('/courses/:id/week/send', h(async (req, res) => {
    const { date, recipient } = req.body || {};
    res.json(await reports.sendWeekly(tid(req), req.params.id, date, recipient));
  }));
  r.get('/courses/:id/reports', h((req, res) => res.json({ log: reports.reportLog(tid(req), req.params.id) })));

  r.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Manejador central de errores.
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera los 10 MB.' : 'No se pudo subir el archivo.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud con formato inválido.' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Ocurrió un error inesperado.' : err.message });
  });

  return r;
}

module.exports = { createApi };
