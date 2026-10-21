// Resumen semanal, exportación a Excel y envío automático por correo.
const { HttpError, isValidDate, mondayOf, weekDays, shortDayLabel, longDateLabel, localParts, addDays } = require('../util');
const { safeFile } = require('./qr');

const LETTER = { presente: 'P', tarde: 'T', ausente: 'A' };

function createReportService(db, courses) {
  function matrixForCourse(course, monday) {
    const days = weekDays(monday);
    const students = db.prepare(`SELECT id, full_name, code, document FROM students
      WHERE course_id = ? AND active = 1 ORDER BY full_name COLLATE NOCASE`).all(course.id);
    const records = db.prepare(`SELECT student_id, date, status FROM attendance
      WHERE course_id = ? AND date BETWEEN ? AND ?`).all(course.id, days[0], days[4]);
    const closed = new Set(db.prepare('SELECT date FROM day_closures WHERE course_id = ? AND date BETWEEN ? AND ?')
      .all(course.id, days[0], days[4]).map((r) => r.date));
    const map = new Map(records.map((r) => [`${r.student_id}|${r.date}`, r.status]));

    const rows = students.map((s) => {
      const cells = days.map((d) => map.get(`${s.id}|${d}`) || null);
      const count = (st) => cells.filter((c) => c === st).length;
      const recorded = cells.filter(Boolean).length;
      const attended = count('presente') + count('tarde');
      return {
        student: s, cells, recorded, attended,
        presente: count('presente'), tarde: count('tarde'), ausente: count('ausente'),
        pct: recorded ? Math.round((attended / recorded) * 100) : null
      };
    });
    const dayInfo = days.map((d, i) => ({
      date: d, label: shortDayLabel(d), closed: closed.has(d),
      presentes: rows.filter((r) => r.cells[i] === 'presente' || r.cells[i] === 'tarde').length,
      registrados: rows.filter((r) => r.cells[i]).length
    }));
    return { course, monday, friday: days[4], days: dayInfo, rows };
  }

  function weekMatrix(teacherId, courseId, date) {
    const course = courses.getCourse(teacherId, courseId);
    const ref = date || localParts().date;
    if (!isValidDate(ref)) throw new HttpError(400, 'Fecha no válida.');
    return matrixForCourse(course, mondayOf(ref));
  }

  async function buildXlsx(matrix) {
    const ExcelJS = require('exceljs');
    const { course, days, rows, monday, friday } = matrix;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia QR';
    const ws = wb.addWorksheet('Asistencia', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] });

    ws.mergeCells('A1:K1');
    ws.getCell('A1').value = `Asistencia semanal · ${course.name}${course.subject ? ' · ' + course.subject : ''}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A2:K2');
    ws.getCell('A2').value = `Semana del ${longDateLabel(monday)} al ${longDateLabel(friday)} · P = presente, T = tarde, A = ausente, vacío = sin registro`;
    ws.getCell('A2').font = { color: { argb: 'FF56656A' }, size: 10 };

    const header = ['Código', 'Estudiante', ...days.map((d) => d.label), 'Asistió', 'Tarde', 'Ausente', '% asistencia'];
    const hr = ws.getRow(4);
    hr.values = header;
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hr.alignment = { horizontal: 'center', vertical: 'middle' };
    hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F54' } }; });
    hr.height = 22;

    const fills = { presente: 'FFDDE8E1', tarde: 'FFFBF0D9', ausente: 'FFFCE9D9' };
    rows.forEach((r, i) => {
      const row = ws.getRow(5 + i);
      row.values = [r.student.code, r.student.full_name, ...r.cells.map((c) => (c ? LETTER[c] : '')),
        r.attended, r.tarde, r.ausente, r.pct === null ? '' : r.pct / 100];
      r.cells.forEach((c, j) => {
        const cell = row.getCell(3 + j);
        cell.alignment = { horizontal: 'center' };
        if (c) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fills[c] } };
      });
      for (let j = 8; j <= 11; j++) row.getCell(j).alignment = { horizontal: 'center' };
      row.getCell(11).numFmt = '0%';
    });

    const totalRow = ws.getRow(5 + rows.length + 1);
    totalRow.values = ['', 'Presentes por día', ...days.map((d) => (d.registrados ? `${d.presentes}/${d.registrados}` : ''))];
    totalRow.font = { bold: true };
    totalRow.eachCell((c, col) => { if (col > 2) c.alignment = { horizontal: 'center' }; });

    const widths = [11, 34, 9, 9, 9, 9, 9, 10, 10, 10, 13];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const fileName = (m) => `Asistencia_${safeFile(m.course.name)}_${m.monday}.xlsx`;

  function mailer() {
    if (!process.env.SMTP_HOST) return null;
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }

  async function sendForCourse(course, monday, recipient) {
    recipient = recipient || course.report_email;
    if (!recipient) throw new HttpError(400, 'Este curso no tiene un correo configurado para el reporte.');
    const transport = mailer();
    if (!transport) throw new HttpError(503, 'El envío de correos no está configurado en el servidor (SMTP).');
    const matrix = matrixForCourse(course, monday);
    const xlsx = await buildXlsx(matrix);
    const total = matrix.rows.length;
    const lowAttendance = matrix.rows.filter((r) => r.pct !== null && r.pct < 80).map((r) => r.student.full_name);
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: recipient,
        subject: `Asistencia semanal ${course.name} · ${longDateLabel(matrix.monday)} al ${longDateLabel(matrix.friday)}`,
        text: [
          `Adjunto el reporte de asistencia de ${course.name} (${total} estudiantes).`,
          '',
          ...matrix.days.map((d) => `${d.label}: ${d.registrados ? `${d.presentes} de ${d.registrados} asistieron` : 'sin registro'}`),
          '',
          lowAttendance.length ? `Asistencia menor al 80%: ${lowAttendance.join(', ')}.` : 'Ningún estudiante tuvo asistencia menor al 80%.'
        ].join('\n'),
        attachments: [{ filename: fileName(matrix), content: xlsx }]
      });
      db.prepare('INSERT INTO report_log (course_id, week_start, recipient, status) VALUES (?, ?, ?, ?)')
        .run(course.id, matrix.monday, recipient, 'enviado');
      return { sent: true, recipient, week_start: matrix.monday };
    } catch (err) {
      db.prepare('INSERT INTO report_log (course_id, week_start, recipient, status, detail) VALUES (?, ?, ?, ?, ?)')
        .run(course.id, matrix.monday, recipient, 'error', String(err.message).slice(0, 500));
      throw new HttpError(502, `No se pudo enviar el correo: ${err.message}`);
    }
  }

  async function sendWeekly(teacherId, courseId, date, recipient) {
    const course = courses.getCourse(teacherId, courseId);
    return sendForCourse(course, mondayOf(date || localParts().date), recipient);
  }

  function reportLog(teacherId, courseId) {
    courses.getCourse(teacherId, courseId);
    return db.prepare('SELECT * FROM report_log WHERE course_id = ? ORDER BY id DESC LIMIT 20').all(Number(courseId));
  }

  // Envía el reporte de la semana a todos los cursos con correo que aún no lo recibieron.
  async function runScheduled(now = new Date()) {
    const monday = mondayOf(localParts(now).date);
    const pending = db.prepare(`
      SELECT c.* FROM courses c
      WHERE c.report_email IS NOT NULL AND c.report_email <> ''
        AND NOT EXISTS (SELECT 1 FROM report_log r WHERE r.course_id = c.id AND r.week_start = ? AND r.status = 'enviado')
        AND (SELECT COUNT(*) FROM report_log r WHERE r.course_id = c.id AND r.week_start = ? AND r.status = 'error') < 3`)
      .all(monday, monday);
    const results = [];
    for (const course of pending) {
      try {
        results.push({ course: course.id, ...(await sendForCourse(course, monday)) });
      } catch (err) {
        results.push({ course: course.id, sent: false, error: err.message });
      }
    }
    return results;
  }

  return { weekMatrix, matrixForCourse, buildXlsx, fileName, sendWeekly, reportLog, runScheduled, nextFriday: (d) => addDays(mondayOf(d), 4) };
}

module.exports = { createReportService };
