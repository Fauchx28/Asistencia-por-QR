// Copias de seguridad de la base de datos.
// - Una copia diaria (por defecto a las 2:00 am, hora del colegio) y otra al arrancar si la última tiene más de 24 h.
// - Se guardan en BACKUP_DIR (por defecto data/backups) y se conservan las últimas BACKUP_KEEP (por defecto 14).
// - Usa VACUUM INTO: genera una copia consistente aunque la app esté en uso.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { localParts } = require('./util');

const PREFIX = 'asistencia-';
const DAY = 24 * 3600 * 1000;

function backupDir() {
  return process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'asistencia.db')), 'backups');
}

function listBackups(dir = backupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .map((f) => ({ file: path.join(dir, f), name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

// Crea una copia y borra las más antiguas. Devuelve la ruta de la copia.
function backupNow(db, { dir = backupDir(), keep = Number(process.env.BACKUP_KEEP || 14), now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = localParts(now).iso.replace(/[:T]/g, '-').slice(0, 16); // 2026-10-23-02-00
  let file = path.join(dir, `${PREFIX}${stamp}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${PREFIX}${stamp}-${i}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  verifyBackup(file);
  for (const old of listBackups(dir).slice(Math.max(1, keep))) fs.rmSync(old.file, { force: true });
  return file;
}

// Comprueba que el archivo sea una base de datos válida de la aplicación.
function verifyBackup(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok)[0] !== 'ok') throw new Error(`La copia ${path.basename(file)} está dañada.`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of ['teachers', 'courses', 'students', 'attendance']) {
      if (!tables.includes(t)) throw new Error(`${path.basename(file)} no parece una copia de Asistencia QR (falta la tabla ${t}).`);
    }
    return {
      teachers: db.prepare('SELECT COUNT(*) n FROM teachers').get().n,
      courses: db.prepare('SELECT COUNT(*) n FROM courses').get().n,
      students: db.prepare('SELECT COUNT(*) n FROM students').get().n,
      attendance: db.prepare('SELECT COUNT(*) n FROM attendance').get().n
    };
  } finally {
    db.close();
  }
}

function startBackups(db) {
  if (process.env.BACKUP_ENABLED === 'false' || process.env.DB_PATH === ':memory:') return null;
  const time = process.env.BACKUP_TIME || '02:00';
  let lastDay = null;
  const run = (reason) => {
    try {
      const file = backupNow(db);
      console.log(`[copia] ${reason}: ${file}`);
    } catch (err) {
      console.error('[copia] no se pudo crear la copia de seguridad:', err.message);
    }
  };
  const latest = listBackups()[0];
  if (!latest || Date.now() - latest.mtime > DAY) run('copia inicial');
  const timer = setInterval(() => {
    const p = localParts();
    if (p.time >= time && lastDay !== p.date) {
      lastDay = p.date;
      const last = listBackups()[0];
      if (!last || Date.now() - last.mtime > DAY / 2) run('copia diaria');
    }
  }, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { backupNow, verifyBackup, listBackups, startBackups, backupDir };
