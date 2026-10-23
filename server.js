// Punto de entrada del servidor.
const fs = require('node:fs');
const path = require('node:path');

if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const express = require('express');
const { openDatabase } = require('./src/db');
const { createAuth } = require('./src/auth');
const { createCourseService } = require('./src/services/courses');
const { createAttendanceService } = require('./src/services/attendance');
const { createReportService } = require('./src/services/reports');
const { createApi } = require('./src/api');
const { startScheduler } = require('./src/scheduler');
const { startBackups } = require('./src/backup');

function createApp(db) {
  const auth = createAuth(db);
  const courses = createCourseService(db);
  const attendance = createAttendanceService(db, courses);
  const reports = createReportService(db, courses);

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      // La cámara solo se permite en este mismo sitio.
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
    });
    next();
  });

  // Para que el hosting sepa si la app está viva.
  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  app.use(auth.loadTeacher);
  app.use('/api', createApi({ db, auth, courses, attendance, reports }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
  // Cualquier otra ruta carga la aplicación (navegación del lado del cliente).
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  return { app, services: { auth, courses, attendance, reports } };
}

if (require.main === module) {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, 'data', 'asistencia.db'));
  const { app, services } = createApp(db);
  startScheduler(services.reports);
  startBackups(db);
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Asistencia QR lista en http://localhost:${port}`));
}

module.exports = { createApp };
