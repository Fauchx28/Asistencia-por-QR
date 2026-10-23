// Importa listas de estudiantes desde Excel (.xlsx), CSV, texto pegado o una foto (OCR con Tesseract).
const { HttpError, parseCsv, rowsToStudents, linesToStudents } = require('../util');

const MAX_STUDENTS = 200;

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

async function fromXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new HttpError(400, 'No pudimos abrir el Excel. Si es un archivo .xls antiguo, guárdalo como .xlsx e inténtalo de nuevo.');
  }
  // Primera hoja que tenga datos.
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values empieza en el índice 1 y puede tener huecos; Array.from los rellena.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values, cellText));
    });
    const students = rowsToStudents(rows);
    if (students.length) return students;
  }
  return [];
}

let workerPromise = null;
function getOcrWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    // El idioma se descarga una vez y queda guardado en OCR_CACHE_DIR (por defecto ./data).
    const cachePath = process.env.OCR_CACHE_DIR || require('node:path').join(__dirname, '..', '..', 'data');
    require('node:fs').mkdirSync(cachePath, { recursive: true });
    workerPromise = createWorker(process.env.OCR_LANG || 'spa', 1, { cachePath }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function fromImage(buffer) {
  let worker;
  try {
    worker = await getOcrWorker();
  } catch (err) {
    console.error('[ocr] no se pudo iniciar Tesseract:', err.message);
    throw new HttpError(503, 'La lectura de fotos no está disponible en este momento. Sube un Excel o escribe los nombres.');
  }
  const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
  const lines = [];
  for (const block of data.blocks || []) {
    for (const p of block.paragraphs || []) {
      for (const l of p.lines || []) lines.push({ text: l.text, confidence: l.confidence });
    }
  }
  if (!lines.length && data.text) lines.push(...data.text.split(/\r?\n/));
  return linesToStudents(lines);
}

// Devuelve { source, students: [{ full_name, document, flag }] }.
async function importStudents({ buffer, filename = '', mimetype = '', text }) {
  let students;
  let source;
  if (typeof text === 'string' && text.trim()) {
    source = 'texto';
    // Texto copiado desde Excel llega separado por tabulaciones; si no, un nombre por línea.
    students = text.includes('\t')
      ? rowsToStudents(text.split(/\r?\n/).map((l) => l.split('\t')))
      : linesToStudents(text.split(/\r?\n/)).map((s) => ({ ...s, flag: false }));
  } else if (buffer) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || mimetype.includes('spreadsheetml')) {
      source = 'excel';
      students = await fromXlsx(buffer);
    } else if (ext === 'csv' || ext === 'txt' || mimetype === 'text/csv' || mimetype === 'text/plain') {
      source = 'csv';
      students = rowsToStudents(parseCsv(buffer.toString('utf8')));
    } else if (ext === 'xls') {
      throw new HttpError(400, 'Los archivos .xls antiguos no son compatibles. Ábrelo en Excel y guárdalo como .xlsx.');
    } else if (/^image\//.test(mimetype) || ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) {
      source = 'foto';
      students = await fromImage(buffer);
    } else {
      throw new HttpError(400, 'Formato no compatible. Usa .xlsx, .csv o una imagen (.jpg, .png).');
    }
  } else {
    throw new HttpError(400, 'Sube un archivo o escribe los nombres.');
  }

  // Quita duplicados exactos.
  const seen = new Set();
  students = students.filter((s) => {
    const k = s.full_name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!students.length) {
    throw new HttpError(422, source === 'foto'
      ? 'No encontramos nombres en la foto. Prueba con una foto más nítida y con buena luz, o sube un Excel.'
      : 'No encontramos nombres en el archivo. Revisa que tenga una columna con los nombres.');
  }
  if (students.length > MAX_STUDENTS) students = students.slice(0, MAX_STUDENTS);
  return { source, students };
}

async function closeOcr() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* nada */ }
  workerPromise = null;
}

module.exports = { importStudents, closeOcr };
