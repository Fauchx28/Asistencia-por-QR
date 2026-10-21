// Cursos y estudiantes. Todas las consultas se limitan a los cursos del docente.
const crypto = require('node:crypto');
const { HttpError, cleanName, today, toMinutes } = require('../util');

const newToken = () => 'aq1_' + crypto.randomBytes(18).toString('base64url');

function createCourseService(db) {
  function validateCourse(data, partial = false) {
    const out = {};
    if (!partial || data.name !== undefined) {
      out.name = String(data.name || '').trim();
      if (!out.name) throw new HttpError(400, 'El curso necesita un nombre.');
      if (out.name.length > 80) throw new HttpError(400, 'El nombre del curso es muy largo.');
    }
    for (const k of ['subject', 'schedule']) {
      if (!partial || data[k] !== undefined) out[k] = String(data[k] || '').trim() || null;
    }
    if (!partial || data.start_time !== undefined) {
      const t = String(data.start_time || '').trim();
      if (t && toMinutes(t) === null) throw new HttpError(400, 'La hora de inicio debe tener formato HH:MM.');
      out.start_time = t || null;
    }
    if (!partial || data.late_minutes !== undefined) {
      const n = data.late_minutes === undefined || data.late_minutes === '' ? 10 : Number(data.late_minutes);
      if (!Number.isInteger(n) || n < 0 || n > 180) throw new HttpError(400, 'Los minutos de tolerancia no son válidos.');
      out.late_minutes = n;
    }
    if (!partial || data.report_email !== undefined) {
      const e = String(data.report_email || '').trim();
      if (e && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e)) throw new HttpError(400, 'El correo para el reporte no es válido.');
      out.report_email = e || null;
    }
    return out;
  }

  function validateStudent(s) {
    const full_name = cleanName(s && s.full_name);
    if (!full_name) throw new HttpError(400, 'Cada estudiante necesita un nombre.');
    if (full_name.length > 120) throw new HttpError(400, `El nombre "${full_name.slice(0, 30)}…" es muy largo.`);
    const document = String((s && s.document) || '').replace(/\s/g, '') || null;
    return { full_name, document };
  }

  const insertStudentStmt = db.prepare(
    'INSERT INTO students (course_id, full_name, document, code, qr_token) VALUES (?, ?, ?, ?, ?)');
  const setCodeStmt = db.prepare('UPDATE students SET code = ? WHERE id = ?');

  function insertStudent(courseId, s) {
    const r = insertStudentStmt.run(courseId, s.full_name, s.document, 'tmp-' + newToken(), newToken());
    const id = Number(r.lastInsertRowid);
    setCodeStmt.run('EST-' + String(id).padStart(4, '0'), id);
    return id;
  }

  function getCourse(teacherId, courseId) {
    const c = db.prepare('SELECT * FROM courses WHERE id = ? AND teacher_id = ?').get(Number(courseId), teacherId);
    if (!c) throw new HttpError(404, 'No encontramos ese curso.');
    return c;
  }

  function listCourses(teacherId) {
    const date = today();
    return db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM students s WHERE s.course_id = c.id AND s.active = 1) AS student_count,
        (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
           WHERE a.course_id = c.id AND a.date = ? AND s.active = 1 AND a.status IN ('presente','tarde')) AS present_today,
        (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
           WHERE a.course_id = c.id AND a.date = ? AND s.active = 1) AS recorded_today,
        EXISTS (SELECT 1 FROM day_closures d WHERE d.course_id = c.id AND d.date = ?) AS closed_today
      FROM courses c WHERE c.teacher_id = ?
      ORDER BY COALESCE(c.start_time, '99:99'), c.name`).all(date, date, date, teacherId)
      .map((c) => ({ ...c, closed_today: Boolean(c.closed_today) }));
  }

  function createCourse(teacherId, data) {
    const course = validateCourse(data);
    const students = (Array.isArray(data.students) ? data.students : []).map(validateStudent);
    if (students.length > 200) throw new HttpError(400, 'Un curso puede tener máximo 200 estudiantes.');
    return db.transaction(() => {
      const r = db.prepare(`INSERT INTO courses (teacher_id, name, subject, schedule, start_time, late_minutes, report_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(teacherId, course.name, course.subject, course.schedule,
        course.start_time, course.late_minutes, course.report_email);
      const courseId = Number(r.lastInsertRowid);
      for (const s of students) insertStudent(courseId, s);
      return getCourse(teacherId, courseId);
    });
  }

  function updateCourse(teacherId, courseId, data) {
    getCourse(teacherId, courseId);
    const fields = validateCourse(data, true);
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE courses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), Number(courseId));
    }
    return getCourse(teacherId, courseId);
  }

  function deleteCourse(teacherId, courseId) {
    getCourse(teacherId, courseId);
    db.prepare('DELETE FROM courses WHERE id = ?').run(Number(courseId));
  }

  function listStudents(teacherId, courseId) {
    getCourse(teacherId, courseId);
    return db.prepare(`SELECT id, full_name, document, code, qr_token FROM students
      WHERE course_id = ? AND active = 1 ORDER BY full_name COLLATE NOCASE`).all(Number(courseId));
  }

  function getStudent(teacherId, studentId) {
    const s = db.prepare(`SELECT s.* FROM students s JOIN courses c ON c.id = s.course_id
      WHERE s.id = ? AND c.teacher_id = ? AND s.active = 1`).get(Number(studentId), teacherId);
    if (!s) throw new HttpError(404, 'No encontramos ese estudiante.');
    return s;
  }

  function addStudent(teacherId, courseId, data) {
    getCourse(teacherId, courseId);
    const id = insertStudent(Number(courseId), validateStudent(data));
    return getStudent(teacherId, id);
  }

  function updateStudent(teacherId, studentId, data) {
    const current = getStudent(teacherId, studentId);
    const s = validateStudent({ full_name: data.full_name ?? current.full_name, document: data.document ?? current.document });
    db.prepare('UPDATE students SET full_name = ?, document = ? WHERE id = ?').run(s.full_name, s.document, current.id);
    return getStudent(teacherId, studentId);
  }

  // Se desactiva en vez de borrar para conservar el historial de asistencia.
  function removeStudent(teacherId, studentId) {
    const s = getStudent(teacherId, studentId);
    db.prepare('UPDATE students SET active = 0, qr_token = ? WHERE id = ?').run('off_' + newToken(), s.id);
  }

  // Nuevo QR: el anterior deja de funcionar.
  function regenerateQr(teacherId, studentId) {
    const s = getStudent(teacherId, studentId);
    db.prepare('UPDATE students SET qr_token = ? WHERE id = ?').run(newToken(), s.id);
    return getStudent(teacherId, studentId);
  }

  return {
    listCourses, getCourse, createCourse, updateCourse, deleteCourse,
    listStudents, getStudent, addStudent, updateStudent, removeStudent, regenerateQr
  };
}

module.exports = { createCourseService };
