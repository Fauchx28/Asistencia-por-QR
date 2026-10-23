// Restaura una copia de seguridad: npm run restore -- ruta/de/la/copia.db
// IMPORTANTE: detén la aplicación antes de restaurar.
const path = require('node:path');
const fs = require('node:fs');
if (fs.existsSync(path.join(__dirname, '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { verifyBackup, listBackups } = require('../src/backup');

const source = process.argv[2];
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'asistencia.db');
if (!source) {
  console.log('Uso: npm run restore -- <archivo de copia>\n\nCopias disponibles (la más reciente primero):');
  for (const b of listBackups()) console.log(`  ${b.file}  (${new Date(b.mtime).toLocaleString('es-CO')})`);
  process.exit(1);
}
if (!fs.existsSync(source)) { console.error(`No existe el archivo ${source}`); process.exit(1); }

const info = verifyBackup(source);
console.log(`Copia válida: ${info.teachers} docentes, ${info.courses} cursos, ${info.students} estudiantes, ${info.attendance} registros.`);
if (fs.existsSync(dbPath)) {
  const safety = `${dbPath}.antes-de-restaurar-${Date.now()}`;
  fs.copyFileSync(dbPath, safety);
  console.log(`La base actual se guardó en ${safety}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.copyFileSync(source, dbPath);
console.log(`Restaurada en ${dbPath}. Ya puedes iniciar la aplicación con npm start.`);
