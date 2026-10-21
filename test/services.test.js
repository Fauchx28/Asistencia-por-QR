// Pruebas de la lógica principal (sin dependencias externas): npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createAuth, hashPassword, verifyPassword } = require('../src/auth');
const { createCourseService } = require('../src/services/courses');
const { createAttendanceService } = require('../src/services/attendance');
const { createReportService } = require('../src/services/reports');
const util = require('../src/util');

process.env.APP_TIMEZONE = 'America/Bogota';

function setup() {
  const db = openDatabase(':memory:');
  const auth = createAuth(db);
  const courses = createCourseService(db);
  const attendance = createAttendanceService(db, courses);
  const reports = createReportService(db, courses);
  const t = auth.register({ name: 'Laura', email: 'laura@colegio.edu', password: 'secreta123' });
  return { db, auth, courses, attendance, reports, t };
}

// 2026-10-21 14:05 UTC = 09:05 en Bogotá
const at = (hhmm, date = '2026-10-21') => new Date(`${date}T${hhmm}:00-05:00`);

test('contraseñas: hash y verificación', () => {
  const h = hashPassword('abc12345');
  assert.ok(verifyPassword('abc12345', h));
  assert.ok(!verifyPassword('otra', h));
});

test('fechas en zona horaria del colegio', () => {
  assert.equal(util.localParts(new Date('2026-10-22T03:00:00Z')).date, '2026-10-21');
  assert.equal(util.mondayOf('2026-10-23'), '2026-10-19');
  assert.equal(util.mondayOf('2026-10-25'), '2026-10-19');
  assert.deepEqual(util.weekDays('2026-10-19'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.equal(util.shortDayLabel('2026-10-21'), 'Mié 21');
});

test('importar filas de Excel/CSV con y sin encabezados', () => {
  const withHeader = util.rowsToStudents([
    ['N°', 'Nombres', 'Apellidos', 'Documento'],
    ['1', 'MARIANA', 'GÓMEZ RÍOS', '1106 987 340'],
    ['2', 'juan  david', 'de la torre', ''],
    ['', '', '', '']
  ]);
  assert.deepEqual(withHeader.map((s) => s.full_name), ['Mariana Gómez Ríos', 'Juan David de la Torre']);
  assert.equal(withHeader[0].document, '1106987340');

  const noHeader = util.rowsToStudents([['1', 'Ana Pérez'], ['2', 'Luis Mora']]);
  assert.deepEqual(noHeader.map((s) => s.full_name), ['Ana Pérez', 'Luis Mora']);

  const csv = util.parseCsv('Nombre completo;Documento\n"Ríos, Ana";123\nPedro Gil;456\n');
  assert.deepEqual(util.rowsToStudents(csv).map((s) => s.full_name), ['Ríos, Ana', 'Pedro Gil']);
});

test('importar líneas de OCR marca las dudosas', () => {
  const out = util.linesToStudents([
    { text: 'LISTA DE ESTUDIANTES 5° B', confidence: 90 },
    { text: '1. Andrés Bermúdez Soto   1.107.234.561', confidence: 92 },
    { text: '2 Juan Hurtad?', confidence: 88 },
    { text: '3) Val3ntina Ortiz', confidence: 91 },
    { text: '4 Sofía Londoño', confidence: 40 },
    { text: '---', confidence: 30 }
  ]);
  assert.deepEqual(out.map((s) => s.full_name), ['Andrés Bermúdez Soto', 'Juan Hurtad', 'Val Ntina Ortiz', 'Sofía Londoño']);
  assert.equal(out[0].document, '1107234561');
  assert.deepEqual(out.map((s) => s.flag), [false, true, true, true]);
});

test('crear curso con estudiantes y códigos únicos', () => {
  const { courses, t } = setup();
  const c = courses.createCourse(t.id, {
    name: '5° B', subject: 'Matemáticas', start_time: '09:00',
    students: [{ full_name: 'ana pérez' }, { full_name: 'Luis Mora', document: '123' }]
  });
  const list = courses.listStudents(t.id, c.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].full_name, 'Ana Pérez');
  assert.match(list[0].code, /^EST-\d{4}$/);
  assert.notEqual(list[0].qr_token, list[1].qr_token);
  assert.throws(() => courses.createCourse(t.id, { name: '' }), /nombre/);
  assert.throws(() => courses.createCourse(t.id, { name: 'X', start_time: '9h' }), /HH:MM/);
});

test('otro docente no puede ver el curso', () => {
  const { courses, auth, t } = setup();
  const c = courses.createCourse(t.id, { name: '5° B' });
  const other = auth.register({ name: 'Pedro', email: 'pedro@colegio.edu', password: 'secreta123' });
  assert.throws(() => courses.getCourse(other.id, c.id), (e) => e.status === 404);
});

test('escaneo: presente, tarde, repetido, otro curso y QR reemplazado', () => {
  const { courses, attendance, t } = setup();
  const c = courses.createCourse(t.id, { name: '5° B', start_time: '09:00', late_minutes: 10,
    students: [{ full_name: 'Ana Pérez' }, { full_name: 'Luis Mora' }] });
  const c2 = courses.createCourse(t.id, { name: '6° A', students: [{ full_name: 'Eva Ruiz' }] });
  const [ana, luis] = courses.listStudents(t.id, c.id);
  const [eva] = courses.listStudents(t.id, c2.id);

  const r1 = attendance.scan(t.id, c.id, ana.qr_token, at('09:05'));
  assert.equal(r1.status, 'presente');
  assert.equal(r1.already, false);
  assert.equal(attendance.scan(t.id, c.id, ana.qr_token, at('09:30')).already, true);
  assert.equal(attendance.scan(t.id, c.id, luis.qr_token, at('09:11')).status, 'tarde');
  assert.throws(() => attendance.scan(t.id, c.id, eva.qr_token, at('09:12')), (e) => e.status === 409);

  const old = luis.qr_token;
  courses.regenerateQr(t.id, luis.id);
  assert.throws(() => attendance.scan(t.id, c.id, old, at('09:13')), (e) => e.status === 404);
  assert.throws(() => attendance.scan(t.id, c.id, 'basura', at('09:13')), (e) => e.status === 404);
});

test('marcado manual, deshacer y cierre del día', () => {
  const { courses, attendance, t } = setup();
  const c = courses.createCourse(t.id, { name: '5° B',
    students: [{ full_name: 'Ana Pérez' }, { full_name: 'Luis Mora' }, { full_name: 'Eva Ruiz' }] });
  const [ana, eva, luis] = courses.listStudents(t.id, c.id);
  const date = util.today();

  attendance.setStatus(t.id, c.id, ana.id, date, 'presente');
  attendance.setStatus(t.id, c.id, eva.id, date, 'tarde');
  attendance.setStatus(t.id, c.id, eva.id, date, null);
  let day = attendance.dayList(t.id, c.id, date);
  assert.deepEqual(day.counts, { presente: 1, tarde: 0, ausente: 0, sin_registrar: 2, total: 3 });

  const closed = attendance.closeDay(t.id, c.id, date);
  assert.equal(closed.marked_absent, 2);
  assert.equal(closed.closed, true);
  assert.equal(closed.counts.ausente, 2);

  // Llega después del cierre: queda como tarde.
  const late = attendance.scan(t.id, c.id, luis.qr_token);
  assert.equal(late.status, 'tarde');
  assert.throws(() => attendance.setStatus(t.id, c.id, ana.id, '2999-01-01', 'presente'), /futura/);
});

test('resumen semanal y estudiante retirado', () => {
  const { db, courses, attendance, reports, t } = setup();
  const c = courses.createCourse(t.id, { name: '5° B', students: [{ full_name: 'Ana Pérez' }, { full_name: 'Luis Mora' }] });
  const [ana, luis] = courses.listStudents(t.id, c.id);
  const ins = db.prepare(`INSERT INTO attendance (course_id, student_id, date, status, method, recorded_at) VALUES (?,?,?,?,?,?)`);
  ins.run(c.id, ana.id, '2026-10-19', 'presente', 'qr', 'x');
  ins.run(c.id, ana.id, '2026-10-20', 'tarde', 'qr', 'x');
  ins.run(c.id, luis.id, '2026-10-19', 'ausente', 'cierre', 'x');
  ins.run(c.id, luis.id, '2026-10-26', 'presente', 'qr', 'x'); // otra semana

  const m = reports.weekMatrix(t.id, c.id, '2026-10-22');
  assert.equal(m.monday, '2026-10-19');
  assert.deepEqual(m.days.map((d) => d.label), ['Lun 19', 'Mar 20', 'Mié 21', 'Jue 22', 'Vie 23']);
  const rowAna = m.rows.find((r) => r.student.id === ana.id);
  assert.deepEqual(rowAna.cells, ['presente', 'tarde', null, null, null]);
  assert.equal(rowAna.pct, 100);
  assert.equal(m.rows.find((r) => r.student.id === luis.id).pct, 0);
  assert.equal(m.days[0].presentes, 1);

  courses.removeStudent(t.id, luis.id);
  assert.equal(reports.weekMatrix(t.id, c.id, '2026-10-22').rows.length, 1);
});

test('el envío programado no repite semanas ya enviadas', async () => {
  const { db, courses, reports, t } = setup();
  const c = courses.createCourse(t.id, { name: '5° B', report_email: 'coord@colegio.edu' });
  db.prepare(`INSERT INTO report_log (course_id, week_start, recipient, status) VALUES (?, ?, ?, 'enviado')`)
    .run(c.id, '2026-10-19', 'coord@colegio.edu');
  const results = await reports.runScheduled(at('16:05', '2026-10-23'));
  assert.deepEqual(results, []);
});
