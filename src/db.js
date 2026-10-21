// Base de datos SQLite usando el módulo integrado de Node (node:sqlite, Node >= 22.13).
// No requiere compilar dependencias nativas.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teachers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v1 guardaba el token en texto plano; v2 guarda solo su hash.
DROP TABLE IF EXISTS sessions;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id          TEXT PRIMARY KEY,           -- identificador público (para listar y cerrar sesiones)
  token_hash  TEXT NOT NULL UNIQUE,       -- sha256 del token de la cookie
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  persistent  INTEGER NOT NULL DEFAULT 0, -- 1 = "Recordarme en este dispositivo"
  user_agent  TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL,           -- milisegundos epoch
  last_seen   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_teacher ON auth_sessions(teacher_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id    INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT,
  schedule      TEXT,
  start_time    TEXT,              -- 'HH:MM' hora de inicio de clase (opcional)
  late_minutes  INTEGER NOT NULL DEFAULT 10,
  report_email  TEXT,              -- destinatario del Excel semanal
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  document   TEXT,
  code       TEXT NOT NULL UNIQUE,  -- código visible, ej. EST-0001
  qr_token   TEXT NOT NULL UNIQUE,  -- lo que va dentro del QR (aleatorio)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,          -- 'YYYY-MM-DD' en la zona horaria del colegio
  status      TEXT NOT NULL CHECK (status IN ('presente','tarde','ausente')),
  method      TEXT NOT NULL CHECK (method IN ('qr','manual','cierre')),
  recorded_at TEXT NOT NULL,          -- ISO con hora local
  UNIQUE (student_id, date)
);

CREATE TABLE IF NOT EXISTS day_closures (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  PRIMARY KEY (course_id, date)
);

CREATE TABLE IF NOT EXISTS report_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL,            -- 'enviado' | 'error'
  detail     TEXT,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_course_date ON attendance(course_id, date);
CREATE INDEX IF NOT EXISTS idx_students_course ON students(course_id);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  // Migraciones simples: agrega columnas nuevas a bases de datos de versiones anteriores.
  const addColumn = (table, column, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  };
  addColumn('teachers', 'last_login_at', 'INTEGER');

  // Ejecuta fn dentro de una transacción; revierte si lanza un error.
  db.transaction = (fn) => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

module.exports = { openDatabase };
