// Crea una copia de seguridad ahora mismo: npm run backup
const path = require('node:path');
const fs = require('node:fs');
if (fs.existsSync(path.join(__dirname, '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { openDatabase } = require('../src/db');
const { backupNow, verifyBackup, listBackups } = require('../src/backup');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'asistencia.db');
if (!fs.existsSync(dbPath)) {
  console.error(`No existe la base de datos ${dbPath}. ¿Ya iniciaste la aplicación alguna vez?`);
  process.exit(1);
}
const file = backupNow(openDatabase(dbPath));
const info = verifyBackup(file);
console.log(`Copia creada: ${file}`);
console.log(`Contiene ${info.teachers} docentes, ${info.courses} cursos, ${info.students} estudiantes y ${info.attendance} registros de asistencia.`);
console.log(`Copias guardadas: ${listBackups().length}. Guarda también una copia fuera de este servidor (por ejemplo en Google Drive).`);
