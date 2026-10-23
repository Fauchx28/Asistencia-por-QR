// Pruebas de copias de seguridad: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { backupNow, verifyBackup, listBackups } = require('../src/backup');

test('crea copias válidas y conserva solo las más recientes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqr-backup-'));
  try {
    const db = openDatabase(path.join(dir, 'app.db'));
    db.prepare("INSERT INTO teachers (name, email, password_hash) VALUES ('Laura', 'l@x.co', 'h')").run();
    const out = path.join(dir, 'backups');
    const files = [];
    for (let i = 0; i < 5; i++) files.push(backupNow(db, { dir: out, keep: 3, now: new Date(Date.UTC(2026, 9, 20 + i, 7)) }));
    const left = listBackups(out).map((b) => b.name).sort();
    assert.equal(left.length, 3);
    assert.deepEqual(left, files.slice(2).map((f) => path.basename(f)).sort());
    assert.equal(verifyBackup(files[4]).teachers, 1);
    // Dos copias en el mismo minuto no se pisan
    const a = backupNow(db, { dir: out, keep: 10, now: new Date(Date.UTC(2026, 9, 30, 7)) });
    const b = backupNow(db, { dir: out, keep: 10, now: new Date(Date.UTC(2026, 9, 30, 7)) });
    assert.notEqual(a, b);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rechaza archivos que no son copias de la aplicación', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aqr-backup-'));
  try {
    const other = path.join(dir, 'otra.db');
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(other);
    d.exec('CREATE TABLE x (a)');
    d.close();
    assert.throws(() => verifyBackup(other), /no parece una copia/);
    const junk = path.join(dir, 'basura.db');
    fs.writeFileSync(junk, 'esto no es sqlite');
    assert.throws(() => verifyBackup(junk));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
