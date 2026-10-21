// Autenticación de docentes: contraseñas con scrypt y sesiones guardadas en SQLite.
const crypto = require('node:crypto');
const { HttpError } = require('./util');

const COOKIE = 'sid';
const SESSION_DAYS = 30;

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

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(db) {
  const insertSession = db.prepare('INSERT INTO sessions (token, teacher_id, expires_at) VALUES (?, ?, ?)');
  const findSession = db.prepare(`
    SELECT t.id, t.name, t.email FROM sessions s JOIN teachers t ON t.id = s.teacher_id
    WHERE s.token = ? AND s.expires_at > ?`);
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  function register({ name, email, password }) {
    name = String(name || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    if (!name) throw new HttpError(400, 'Escribe tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El correo no es válido.');
    if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
    if (db.prepare('SELECT 1 FROM teachers WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
    }
    const r = db.prepare('INSERT INTO teachers (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, hashPassword(password));
    return { id: Number(r.lastInsertRowid), name, email };
  }

  function login({ email, password }) {
    const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!t || !verifyPassword(String(password || ''), t.password_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    return { id: t.id, name: t.name, email: t.email };
  }

  function startSession(res, teacherId) {
    purge.run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_DAYS * 86400000;
    insertSession.run(token, teacherId, expires);
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) deleteSession.run(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  // Middleware: carga req.teacher si hay sesión válida.
  function loadTeacher(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.teacher = token ? findSession.get(token, Date.now()) || null : null;
    next();
  }

  function requireTeacher(req, res, next) {
    if (!req.teacher) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    next();
  }

  return { register, login, startSession, endSession, loadTeacher, requireTeacher };
}

module.exports = { createAuth, hashPassword, verifyPassword, parseCookies };
