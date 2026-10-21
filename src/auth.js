// Cuentas de docentes y sesiones.
// - Contraseñas con scrypt.
// - La cookie lleva un token aleatorio; en la base solo se guarda su hash (sha256).
// - Sesión normal: termina al cerrar el navegador o tras 12 h sin actividad.
//   "Recordarme": dura 30 días desde la última actividad.
// - Límite de intentos fallidos de ingreso por IP y correo.
const crypto = require('node:crypto');
const { HttpError } = require('./util');

const COOKIE = 'sid';
const HOUR = 3600 * 1000;
const SHORT_TTL = 12 * HOUR;
const LONG_TTL = 30 * 24 * HOUR;
const TOUCH_EVERY = 5 * 60 * 1000;     // actualiza "última actividad" como máximo cada 5 min
const RESET_TTL = 1 * HOUR;
const MIN_PASSWORD = 8;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Hash ficticio para que un correo inexistente tarde lo mismo que uno real.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie inválida */ }
    }
  }
  return out;
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
  if (password.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.');
}

// "Chrome en Android", "Safari en iPhone"… para la lista de sesiones.
function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} en ${os}` : browser;
}

// Limitador en memoria de intentos fallidos.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const prune = (key, now) => {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    blocked(key, now = Date.now()) {
      const list = prune(key, now);
      if (list.length < max) return 0;
      return Math.ceil((windowMs - (now - list[0])) / 60000); // minutos de espera
    },
    fail(key, now = Date.now()) { hits.set(key, [...prune(key, now), now]); },
    clear(key) { hits.delete(key); },
    clearWhere(fn) { for (const k of hits.keys()) if (fn(k)) hits.delete(k); }
  };
}

function createAuth(db, { now = () => Date.now() } = {}) {
  const loginLimiter = createLimiter({ max: 5, windowMs: 15 * 60 * 1000 });   // por IP + correo
  const ipLimiter = createLimiter({ max: 30, windowMs: 15 * 60 * 1000 });     // por IP
  const resetLimiter = createLimiter({ max: 3, windowMs: 60 * 60 * 1000 });   // solicitudes de recuperación por correo

  const findSession = db.prepare(`
    SELECT s.id AS session_id, s.persistent, s.last_seen, t.id, t.name, t.email
    FROM auth_sessions s JOIN teachers t ON t.id = s.teacher_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  const touchSession = db.prepare('UPDATE auth_sessions SET last_seen = ?, expires_at = ? WHERE id = ?');

  function registrationRequiresCode() {
    return Boolean(process.env.REGISTRATION_CODE);
  }

  function register({ name, email, password, password_confirm, code }) {
    if (process.env.ALLOW_REGISTRATION === 'false') throw new HttpError(403, 'El registro de nuevas cuentas está desactivado.');
    name = String(name || '').replace(/\s+/g, ' ').trim();
    email = String(email || '').trim().toLowerCase();
    if (!name) throw new HttpError(400, 'Escribe tu nombre.');
    if (name.length > 80) throw new HttpError(400, 'El nombre es demasiado largo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new HttpError(400, 'El correo no es válido.');
    checkPassword(password);
    if (password_confirm !== undefined && password_confirm !== password) throw new HttpError(400, 'Las contraseñas no coinciden.');
    if (registrationRequiresCode()) {
      const expected = sha256(String(process.env.REGISTRATION_CODE).trim().toLowerCase());
      const given = sha256(String(code || '').trim().toLowerCase());
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
        throw new HttpError(403, 'El código del colegio no es correcto. Pídeselo a coordinación.');
      }
    }
    if (db.prepare('SELECT 1 FROM teachers WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.');
    }
    const r = db.prepare('INSERT INTO teachers (name, email, password_hash, last_login_at) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(password), now());
    return { id: Number(r.lastInsertRowid), name, email };
  }

  function login({ email, password }, ip = '') {
    email = String(email || '').trim().toLowerCase();
    const key = `${ip}|${email}`;
    const wait = loginLimiter.blocked(key, now()) || ipLimiter.blocked(ip, now());
    if (wait) throw new HttpError(429, `Demasiados intentos fallidos. Espera ${wait} minuto${wait === 1 ? '' : 's'} e inténtalo de nuevo.`);

    const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(email);
    const ok = verifyPassword(String(password || ''), t ? t.password_hash : DUMMY_HASH) && Boolean(t);
    if (!ok) {
      loginLimiter.fail(key, now());
      ipLimiter.fail(ip, now());
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    loginLimiter.clear(key);
    db.prepare('UPDATE teachers SET last_login_at = ? WHERE id = ?').run(now(), t.id);
    return { id: t.id, name: t.name, email: t.email };
  }

  // Crea la sesión y pone la cookie. `remember` = cookie persistente de 30 días.
  function startSession(req, res, teacherId, { remember = false } = {}) {
    const ts = now();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(ts);
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomBytes(9).toString('base64url');
    db.prepare(`INSERT INTO auth_sessions (id, token_hash, teacher_id, persistent, user_agent, ip, created_at, last_seen, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sha256(token), teacherId, remember ? 1 : 0,
      String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req), ts, ts, ts + (remember ? LONG_TTL : SHORT_TTL));
    setCookie(res, token, remember ? LONG_TTL : null);
    return id;
  }

  function setCookie(res, token, maxAgeMs) {
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    const age = maxAgeMs === null ? '' : `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${age}${secure}`);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
    setCookie(res, '', 0);
  }

  // Middleware: carga req.teacher y req.sessionId si hay una sesión válida.
  function loadTeacher(req, res, next) {
    req.teacher = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const ts = now();
      const row = findSession.get(sha256(token), ts);
      if (row) {
        req.teacher = { id: row.id, name: row.name, email: row.email };
        req.sessionId = row.session_id;
        if (ts - row.last_seen > TOUCH_EVERY) touchSession.run(ts, ts + (row.persistent ? LONG_TTL : SHORT_TTL), row.session_id);
      }
    }
    next();
  }

  function requireTeacher(req, res, next) {
    if (!req.teacher) return res.status(401).json({ error: 'Tu sesión terminó. Vuelve a ingresar.', code: 'session_expired' });
    next();
  }

  // ---- Mi cuenta
  function getAccount(teacherId, currentSessionId) {
    const t = db.prepare('SELECT id, name, email, created_at, last_login_at FROM teachers WHERE id = ?').get(teacherId);
    const sessions = db.prepare(`SELECT id, persistent, user_agent, ip, created_at, last_seen FROM auth_sessions
      WHERE teacher_id = ? AND expires_at > ? ORDER BY last_seen DESC`).all(teacherId, now())
      .map((s) => ({
        id: s.id, device: describeAgent(s.user_agent || ''), ip: s.ip, persistent: Boolean(s.persistent),
        created_at: s.created_at, last_seen: s.last_seen, current: s.id === currentSessionId
      }));
    return { teacher: t, sessions };
  }

  function updateProfile(teacherId, { name }) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!name) throw new HttpError(400, 'Escribe tu nombre.');
    if (name.length > 80) throw new HttpError(400, 'El nombre es demasiado largo.');
    db.prepare('UPDATE teachers SET name = ? WHERE id = ?').run(name, teacherId);
    return db.prepare('SELECT id, name, email FROM teachers WHERE id = ?').get(teacherId);
  }

  // Cambia la contraseña y cierra las demás sesiones abiertas.
  function changePassword(teacherId, currentSessionId, { current_password, new_password, password_confirm }) {
    const t = db.prepare('SELECT password_hash FROM teachers WHERE id = ?').get(teacherId);
    if (!verifyPassword(String(current_password || ''), t.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
    checkPassword(new_password);
    if (password_confirm !== undefined && password_confirm !== new_password) throw new HttpError(400, 'Las contraseñas no coinciden.');
    db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), teacherId);
    const closed = revokeOtherSessions(teacherId, currentSessionId);
    return { closed_sessions: closed };
  }

  function revokeSession(teacherId, sessionId) {
    const r = db.prepare('DELETE FROM auth_sessions WHERE id = ? AND teacher_id = ?').run(String(sessionId), teacherId);
    if (!r.changes) throw new HttpError(404, 'Esa sesión ya no existe.');
  }

  function revokeOtherSessions(teacherId, currentSessionId) {
    return Number(db.prepare('DELETE FROM auth_sessions WHERE teacher_id = ? AND id <> ?').run(teacherId, String(currentSessionId || '')).changes);
  }

  // ---- Recuperar contraseña
  // Devuelve { teacher, token } si corresponde enviar un correo; null si no (sin revelar si el correo existe).
  function createResetToken(email, ip = '') {
    email = String(email || '').trim().toLowerCase();
    if (resetLimiter.blocked(email, now()) || ipLimiter.blocked(ip, now())) return null;
    resetLimiter.fail(email, now());
    const t = db.prepare('SELECT id, name, email FROM teachers WHERE email = ?').get(email);
    if (!t) { ipLimiter.fail(ip, now()); return null; }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM password_resets WHERE teacher_id = ? OR expires_at <= ?').run(t.id, now());
    db.prepare('INSERT INTO password_resets (token_hash, teacher_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), t.id, now() + RESET_TTL);
    return { teacher: t, token };
  }

  function checkResetToken(token) {
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token || '')));
    if (!row || row.used_at || row.expires_at <= now()) {
      throw new HttpError(400, 'El enlace para restablecer la contraseña no es válido o ya venció. Solicita uno nuevo.');
    }
    return row;
  }

  // Cambia la contraseña con el enlace del correo y cierra todas las sesiones anteriores.
  function resetPassword({ token, new_password, password_confirm }) {
    const row = checkResetToken(token);
    checkPassword(new_password);
    if (password_confirm !== undefined && password_confirm !== new_password) throw new HttpError(400, 'Las contraseñas no coinciden.');
    return db.transaction(() => {
      db.prepare('UPDATE teachers SET password_hash = ?, last_login_at = ? WHERE id = ?').run(hashPassword(new_password), now(), row.teacher_id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
      db.prepare('DELETE FROM auth_sessions WHERE teacher_id = ?').run(row.teacher_id);
      const teacher = db.prepare('SELECT id, name, email FROM teachers WHERE id = ?').get(row.teacher_id);
      // Con la contraseña nueva ya puede ingresar aunque antes la hubieran bloqueado por intentos fallidos.
      loginLimiter.clearWhere((k) => k.endsWith(`|${teacher.email}`));
      return teacher;
    });
  }

  return {
    register, login, startSession, endSession, loadTeacher, requireTeacher, registrationRequiresCode,
    getAccount, updateProfile, changePassword, revokeSession, revokeOtherSessions,
    createResetToken, checkResetToken, resetPassword
  };
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { createAuth, hashPassword, verifyPassword, parseCookies, describeAgent, clientIp };
