// Prueba de punta a punta con las librerías reales (Express, ExcelJS, PDFKit, QRCode, Archiver, Nodemailer, Tesseract).
// Requiere `npm install`. Corre con: npm run test:e2e  (también se ejecuta en GitHub Actions en cada push).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const DEPS = ['express', 'multer', 'exceljs', 'qrcode', 'pdfkit', 'archiver', 'nodemailer', 'tesseract.js', 'jsqr', 'pngjs'];
const missing = DEPS.filter((m) => { try { require.resolve(m); return false; } catch { return true; } });
const skip = missing.length ? `faltan dependencias: ${missing.join(', ')} (ejecuta npm install)` : false;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aqr-e2e-'));
Object.assign(process.env, {
  SMTP_HOST: 'json', APP_URL: 'http://localhost:3000', APP_TIMEZONE: 'America/Bogota',
  REPORT_AUTO_SEND: 'false', BACKUP_ENABLED: 'false', OCR_CACHE_DIR: path.join(tmp, 'ocr'),
  BACKUP_DIR: path.join(tmp, 'backups'), ADMIN_EMAILS: 'laura@colegio.edu'
});

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

test('flujo completo con librerías reales', { skip, timeout: 300000 }, async (t) => {
  const ExcelJS = require('exceljs');
  const { PNG } = require('pngjs');
  const jsQRmod = require('jsqr');
  const jsQR = jsQRmod.default || jsQRmod;
  const { createApp } = require('../server');
  const { openDatabase } = require('../src/db');
  const { outbox } = require('../src/mailer');
  const { closeOcr } = require('../src/services/importer');

  const db = openDatabase(':memory:');
  const { app } = createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close();
    await closeOcr();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  let cookie = '';
  async function call(method, url, { json, form, headers = {} } = {}) {
    const opts = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookie) opts.headers.cookie = cookie;
    if (json !== undefined) { opts.body = JSON.stringify(json); opts.headers['content-type'] = 'application/json'; }
    if (form) opts.body = form;
    const res = await fetch(base + url, opts);
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const m = /^sid=([^;]*)/.exec(c);
      if (m) cookie = m[1] ? `sid=${m[1]}` : '';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let body = null;
    if ((res.headers.get('content-type') || '').includes('json')) body = JSON.parse(buf.toString('utf8'));
    return { status: res.status, type: res.headers.get('content-type') || '', headers: res.headers, body, buf };
  }
  const upload = (name, data, type) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], { type }), name);
    return fd;
  };
  const waitMail = async (pred) => {
    for (let i = 0; i < 50; i++) {
      const m = outbox.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('No llegó el correo esperado');
  };

  let course;
  let students;

  await t.test('servidor, páginas y salud', async () => {
    assert.equal((await call('GET', '/api/health')).body.ok, true);
    const home = await call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.buf.toString(), /Asistencia QR/);
    for (const p of ['/app.js', '/styles.css', '/privacidad.html', '/autorizacion-acudientes.html', '/plantilla-estudiantes.csv']) {
      assert.equal((await call('GET', p)).status, 200, p);
    }
    assert.equal((await call('GET', '/api/courses')).status, 401);
  });

  await t.test('registro de la primera vez', async () => {
    const data = { name: 'Laura Rendón', email: 'laura@colegio.edu', password: 'secreta123', password_confirm: 'secreta123' };
    assert.equal((await call('POST', '/api/auth/register', { json: data })).status, 400, 'exige aceptar la política');
    const r = await call('POST', '/api/auth/register', { json: { ...data, accept_terms: true } });
    assert.equal(r.status, 201);
    assert.ok(cookie, 'pone la cookie de sesión');
    assert.equal((await call('GET', '/api/auth/me')).body.teacher.email, 'laura@colegio.edu');
  });

  await t.test('rechaza peticiones de otros sitios', async () => {
    const r = await call('POST', '/api/courses', { json: { name: 'X' }, headers: { origin: 'https://otro-sitio.example' } });
    assert.equal(r.status, 403);
  });

  await t.test('importar Excel (.xlsx)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lista');
    ws.addRow(['N°', 'Nombres', 'Apellidos', 'Documento']);
    ws.addRow([1, 'MARIANA', 'GÓMEZ RÍOS', 1106987340]);
    ws.addRow([2, 'juan david', 'de la torre', null]);
    ws.addRow([3, 'Sofía', 'Londoño Gil', '1.107.455.118']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await call('POST', '/api/import', { form: upload('lista.xlsx', buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.source, 'excel');
    assert.deepEqual(r.body.students.map((s) => s.full_name), ['Mariana Gómez Ríos', 'Juan David de la Torre', 'Sofía Londoño Gil']);
    assert.equal(r.body.students[0].document, '1106987340');
  });

  await t.test('importar CSV y texto pegado', async () => {
    const csv = 'Nombre completo;Documento\nEva Ruiz;123\nPedro Gil;\n';
    const r = await call('POST', '/api/import', { form: upload('lista.csv', Buffer.from(csv), 'text/csv') });
    assert.deepEqual(r.body.students.map((s) => s.full_name), ['Eva Ruiz', 'Pedro Gil']);
    const r2 = await call('POST', '/api/import', { json: { text: '1. Ana Pérez\n2. luis mora' } });
    assert.deepEqual(r2.body.students.map((s) => s.full_name), ['Ana Pérez', 'Luis Mora']);
    const bad = await call('POST', '/api/import', { form: upload('x.pdf', Buffer.from('%PDF'), 'application/pdf') });
    assert.equal(bad.status, 400);
  });

  await t.test('leer nombres de una foto (Tesseract)', async () => {
    const img = fs.readFileSync(path.join(__dirname, 'fixtures', 'lista-foto.jpg'));
    const r = await call('POST', '/api/import', { form: upload('lista.jpg', img, 'image/jpeg') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const found = r.body.students.map((s) => norm(s.full_name));
    t.diagnostic(`OCR leyó: ${r.body.students.map((s) => s.full_name + (s.flag ? ' (revisar)' : '')).join(' | ')}`);
    const expected = ['Andrés Bermúdez Soto', 'Camila Castaño Vélez', 'Daniel Escobar Ruiz', 'Mariana Gómez Ríos',
      'Juan David Hurtado', 'Sofía Londoño Gil', 'Nicolás Muñoz Paz', 'Valentina Ortiz Mejía'];
    const hits = expected.filter((n) => found.includes(norm(n)));
    assert.ok(hits.length >= 6, `solo reconoció ${hits.length} de 8 nombres`);
    assert.ok(!found.some((n) => n.includes('lista de estudiantes')), 'ignora el título');
  });

  await t.test('crear curso con estudiantes', async () => {
    const r = await call('POST', '/api/courses', { json: {
      name: '5° B', subject: 'Matemáticas',
      students: [{ full_name: 'Mariana Gómez Ríos', document: '1106987340' }, { full_name: 'Juan David de la Torre' }, { full_name: 'Sofía Londoño Gil' }]
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    course = r.body.course;
    students = (await call('GET', `/api/courses/${course.id}/students`)).body.students;
    assert.equal(students.length, 3);
  });

  await t.test('el QR en PNG se puede escanear y contiene el token', async () => {
    const s = students[0];
    const r = await call('GET', `/api/students/${s.id}/qr.png?size=400`);
    assert.equal(r.status, 200);
    assert.match(r.type, /image\/png/);
    const png = PNG.sync.read(r.buf);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, 'jsQR pudo leer el código');
    assert.equal(decoded.data, s.qr_token);
  });

  await t.test('carnés en PDF y QR en ZIP', async () => {
    const pdf = await call('GET', `/api/courses/${course.id}/qr.pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.type, /application\/pdf/);
    assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.buf.length > 5000, `PDF muy pequeño: ${pdf.buf.length} bytes`);
    assert.match(pdf.headers.get('content-disposition'), /Carnes_QR_5-B\.pdf/);

    const zip = await call('GET', `/api/courses/${course.id}/qr.zip`);
    assert.equal(zip.status, 200);
    assert.equal(zip.buf.subarray(0, 4).toString('hex'), '504b0304');
    const entries = zip.buf.toString('latin1').split('PK\u0001\u0002').length - 1;
    assert.equal(entries, 3, 'un PNG por estudiante');
  });

  await t.test('escaneo, repetido, código inválido y cierre del día', async () => {
    const scan = (token) => call('POST', `/api/courses/${course.id}/attendance/scan`, { json: { token } });
    const r = await scan(students[0].qr_token);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'presente');
    assert.equal((await scan(students[0].qr_token)).body.already, true);
    assert.equal((await scan('codigo-falso')).status, 404);
    const closed = await call('POST', `/api/courses/${course.id}/attendance/close`, { json: {} });
    assert.equal(closed.body.marked_absent, 2);
  });

  await t.test('Excel semanal con los datos correctos', async () => {
    const ins = db.prepare(`INSERT INTO attendance (course_id, student_id, date, status, method, recorded_at) VALUES (?,?,?,?,?,?)`);
    ins.run(course.id, students[0].id, '2026-10-19', 'presente', 'qr', '2026-10-19T07:01:00');
    ins.run(course.id, students[0].id, '2026-10-20', 'tarde', 'qr', '2026-10-20T07:20:00');
    ins.run(course.id, students[1].id, '2026-10-19', 'ausente', 'cierre', '2026-10-19T09:00:00');
    const r = await call('GET', `/api/courses/${course.id}/week.xlsx?date=2026-10-21`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /Asistencia_5-B_2026-10-19\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buf);
    const ws = wb.getWorksheet('Asistencia');
    assert.deepEqual(ws.getRow(4).values.slice(1, 8), ['Código', 'Estudiante', 'Lun 19', 'Mar 20', 'Mié 21', 'Jue 22', 'Vie 23']);
    const rowOf = (name) => { let found = null; ws.eachRow((row) => { if (row.getCell(2).value === name) found = row; }); return found; };
    const mariana = rowOf(students[0].full_name);
    assert.ok(mariana, 'fila de la estudiante');
    assert.deepEqual([3, 4].map((c) => mariana.getCell(c).value), ['P', 'T']);
    assert.equal(rowOf(students[1].full_name).getCell(3).value, 'A');
  });

  await t.test('envío del reporte por correo con el Excel adjunto', async () => {
    await call('PUT', `/api/courses/${course.id}`, { json: { report_email: 'coordinacion@colegio.edu.co' } });
    const r = await call('POST', `/api/courses/${course.id}/week/send`, { json: { date: '2026-10-21' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mail = await waitMail((m) => JSON.stringify(m.to).includes('coordinacion@colegio.edu.co'));
    assert.match(mail.subject, /Asistencia semanal 5° B/);
    const att = mail.attachments[0];
    assert.match(att.filename, /\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(att.content, att.encoding === 'base64' ? 'base64' : undefined));
    assert.ok(wb.getWorksheet('Asistencia'));
  });

  await t.test('recuperar contraseña por correo', async () => {
    assert.equal((await call('POST', '/api/auth/forgot', { json: { email: 'laura@colegio.edu' } })).status, 200);
    const mail = await waitMail((m) => /Restablece tu contraseña/.test(m.subject));
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)[1]);
    assert.equal((await call('GET', `/api/auth/reset/check?token=${encodeURIComponent(token)}`)).status, 200);
    const r = await call('POST', '/api/auth/reset', { json: { token, new_password: 'nuevaClave1', password_confirm: 'nuevaClave1' } });
    assert.equal(r.status, 200);
    cookie = '';
    assert.equal((await call('POST', '/api/auth/login', { json: { email: 'laura@colegio.edu', password: 'secreta123' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { json: { email: 'laura@colegio.edu', password: 'nuevaClave1' } })).status, 200);
  });

  await t.test('el administrador crea y descarga copias de seguridad', async () => {
    assert.equal((await call('GET', '/api/auth/me')).body.teacher.is_admin, true);
    const made = await call('POST', '/api/admin/backups');
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const list = (await call('GET', '/api/admin/backups')).body.backups;
    assert.equal(list.length, 1);
    const file = await call('GET', `/api/admin/backups/${encodeURIComponent(list[0].name)}`);
    assert.equal(file.buf.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await call('GET', '/api/admin/backups/..%2F..%2Fetc%2Fpasswd')).status, 404);
  });

  await t.test('eliminar la cuenta borra todo', async () => {
    const r = await call('DELETE', '/api/account', { json: { password: 'nuevaClave1', confirm: 'ELIMINAR' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call('GET', '/api/courses')).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM students').get().n, 0);
  });
});
