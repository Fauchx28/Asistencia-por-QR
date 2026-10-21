// Registro de asistencia: escaneo QR, marcado manual y cierre del día.
const { HttpError, localParts, isValidDate, toMinutes } = require('../util');

const STATUSES = ['presente', 'tarde', 'ausente'];

function createAttendanceService(db, courses) {
  const upsert = db.prepare(`
    INSERT INTO attendance (course_id, student_id, date, status, method, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (student_id, date) DO UPDATE SET
      status = excluded.status, method = excluded.method, recorded_at = excluded.recorded_at`);

  function checkDate(date) {
    if (!isValidDate(date)) throw new HttpError(400, 'Fecha no válida.');
    if (date > localParts().date) throw new HttpError(400, 'No se puede registrar asistencia en una fecha futura.');
    return date;
  }

  function dayList(teacherId, courseId, date) {
    const course = courses.getCourse(teacherId, courseId);
    date = date || localParts().date;
    if (!isValidDate(date)) throw new HttpError(400, 'Fecha no válida.');
    const students = db.prepare(`
      SELECT s.id, s.full_name, s.code, a.status, a.method, a.recorded_at
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
      WHERE s.course_id = ? AND s.active = 1
      ORDER BY s.full_name COLLATE NOCASE`).all(date, course.id);
    const counts = { presente: 0, tarde: 0, ausente: 0, sin_registrar: 0, total: students.length };
    for (const s of students) counts[s.status || 'sin_registrar']++;
    const closed = Boolean(db.prepare('SELECT 1 FROM day_closures WHERE course_id = ? AND date = ?').get(course.id, date));
    return { course, date, closed, counts, students };
  }

  // Determina si llega a tiempo o tarde según la hora de inicio y la tolerancia del curso.
  function statusForTime(course, hhmm) {
    const start = toMinutes(course.start_time);
    if (start === null) return 'presente';
    return toMinutes(hhmm) > start + (course.late_minutes ?? 10) ? 'tarde' : 'presente';
  }

  function scan(teacherId, courseId, token, now = new Date()) {
    const course = courses.getCourse(teacherId, courseId);
    token = String(token || '').trim();
    if (!token) throw new HttpError(400, 'El código QR está vacío.');

    const student = db.prepare(`
      SELECT s.*, c.name AS course_name FROM students s JOIN courses c ON c.id = s.course_id
      WHERE s.qr_token = ? AND s.active = 1 AND c.teacher_id = ?`).get(token, teacherId);
    if (!student) {
      throw new HttpError(404, 'Este código no corresponde a ningún estudiante activo. Puede ser un carné reemplazado.');
    }
    if (student.course_id !== course.id) {
      throw new HttpError(409, `${student.full_name} pertenece a ${student.course_name}, no a este curso.`);
    }

    const local = localParts(now);
    const existing = db.prepare('SELECT * FROM attendance WHERE student_id = ? AND date = ?').get(student.id, local.date);
    const base = { student: { id: student.id, full_name: student.full_name, code: student.code } };
    if (existing && existing.status !== 'ausente') {
      return { ...base, already: true, status: existing.status, recorded_at: existing.recorded_at };
    }
    // Si fue marcado ausente (p. ej. al cerrar el día) y llega después, queda como tarde.
    const status = existing ? 'tarde' : statusForTime(course, local.time);
    upsert.run(course.id, student.id, local.date, status, 'qr', local.iso);
    return { ...base, already: false, status, recorded_at: local.iso };
  }

  // status = 'presente' | 'tarde' | 'ausente' | null (null quita el registro: "deshacer").
  function setStatus(teacherId, courseId, studentId, date, status) {
    const course = courses.getCourse(teacherId, courseId);
    date = checkDate(date || localParts().date);
    const student = db.prepare('SELECT id FROM students WHERE id = ? AND course_id = ? AND active = 1').get(Number(studentId), course.id);
    if (!student) throw new HttpError(404, 'No encontramos ese estudiante en el curso.');
    if (status === null || status === '' || status === undefined) {
      db.prepare('DELETE FROM attendance WHERE student_id = ? AND date = ?').run(student.id, date);
      return { student_id: student.id, date, status: null };
    }
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Estado no válido.');
    upsert.run(course.id, student.id, date, status, 'manual', localParts().iso);
    return { student_id: student.id, date, status };
  }

  // Marca como ausentes a quienes no se registraron y deja el día cerrado.
  function closeDay(teacherId, courseId, date) {
    const course = courses.getCourse(teacherId, courseId);
    date = checkDate(date || localParts().date);
    const nowIso = localParts().iso;
    const marked = db.transaction(() => {
      const missing = db.prepare(`
        SELECT s.id FROM students s
        LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
        WHERE s.course_id = ? AND s.active = 1 AND a.id IS NULL`).all(date, course.id);
      for (const s of missing) upsert.run(course.id, s.id, date, 'ausente', 'cierre', nowIso);
      db.prepare(`INSERT INTO day_closures (course_id, date, closed_at) VALUES (?, ?, ?)
        ON CONFLICT (course_id, date) DO UPDATE SET closed_at = excluded.closed_at`).run(course.id, date, nowIso);
      return missing.length;
    });
    return { ...dayList(teacherId, courseId, date), marked_absent: marked };
  }

  return { dayList, scan, setStatus, closeDay, statusForTime };
}

module.exports = { createAttendanceService };
