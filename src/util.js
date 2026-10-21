// Utilidades sin dependencias: fechas en la zona horaria del colegio, CSV y limpieza de nombres.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TZ = () => process.env.APP_TIMEZONE || 'America/Bogota';

// Partes de fecha/hora "ahora" (o de `date`) en la zona horaria configurada.
function localParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`,
    weekday: p.weekday
  };
}

const today = () => localParts().date;

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Lunes de la semana que contiene dateStr.
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(dateStr, -dow);
}

// Días lectivos (lunes a viernes) de la semana que empieza en `monday`.
function weekDays(monday) {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function longDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Minutos desde medianoche para 'HH:MM'.
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Parser CSV simple (RFC 4180): comillas, comas o punto y coma, saltos de línea.
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// Normaliza espacios y mayúsculas: "  juan  PÉREZ " -> "Juan Pérez".
function cleanName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const lowerWords = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  return s
    .toLocaleLowerCase('es')
    .split(' ')
    .map((w, i) => (i > 0 && lowerWords.has(w) ? w : w.charAt(0).toLocaleUpperCase('es') + w.slice(1)))
    .join(' ');
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const NAME_HEADERS = ['nombre completo', 'nombres y apellidos', 'estudiante', 'alumno', 'nombre', 'nombres', 'student', 'name'];
const LASTNAME_HEADERS = ['apellidos', 'apellido'];
const DOC_HEADERS = ['documento', 'identificacion', 'doc', 'ti', 'cc', 'cedula', 'tarjeta de identidad', 'id', 'numero de documento'];

// Convierte filas tabulares (de Excel o CSV) en estudiantes.
// Detecta encabezados comunes; si no hay, usa la primera columna con texto como nombre.
function rowsToStudents(rows) {
  const cleanRows = rows.map((r) => r.map((v) => (v == null ? '' : String(v).trim())));
  if (!cleanRows.length) return [];

  const header = cleanRows[0].map(norm);
  const find = (list) => header.findIndex((h) => list.includes(h));
  let nameCol = find(NAME_HEADERS);
  const lastCol = find(LASTNAME_HEADERS);
  const docCol = find(DOC_HEADERS);
  const hasHeader = nameCol >= 0 || lastCol >= 0 || docCol >= 0;
  const body = hasHeader ? cleanRows.slice(1) : cleanRows;

  if (nameCol < 0 && lastCol < 0) {
    // Sin encabezado de nombre: la columna con más celdas de letras.
    const width = Math.max(...body.map((r) => r.length));
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < width; c++) {
      const score = body.filter((r) => /[a-záéíóúñ]{2,}/i.test(r[c] || '') && !/^\d+$/.test(r[c] || '')).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    nameCol = best;
  }

  const out = [];
  for (const r of body) {
    let name = nameCol >= 0 ? r[nameCol] || '' : '';
    if (lastCol >= 0 && r[lastCol]) name = `${name} ${r[lastCol]}`;
    name = name.replace(/^\s*\d+[.)\-\s]+/, ''); // quita numeración "1. "
    const full = cleanName(name);
    if (!full || !/[a-záéíóúñ]/i.test(full)) continue;
    let doc = docCol >= 0 ? (r[docCol] || '').replace(/\s/g, '') : '';
    out.push({ full_name: full, document: doc || null, flag: false });
  }
  return out;
}

// Extrae nombres de texto OCR (una línea por estudiante).
// Marca para revisión las líneas con caracteres sospechosos o baja confianza.
function linesToStudents(lines) {
  const skip = /^(lista|listado|curso|grado|grupo|materia|profesor|docente|asistencia|nombre|nombres|apellidos|estudiantes?|fecha|n[°º.]?|no\.?|#)\b/i;
  const out = [];
  for (const item of lines) {
    const text = typeof item === 'string' ? item : item.text;
    const confidence = typeof item === 'string' ? 100 : item.confidence;
    let line = String(text || '').trim();
    if (!line || skip.test(norm(line))) continue;

    line = line.replace(/^\s*\d{1,3}\s*[.)\-:|]?\s*/, ''); // numeración inicial
    const docMatch = line.match(/(\d[\d.\s]{5,}\d)\s*$/);
    let document = null;
    if (docMatch) {
      document = docMatch[1].replace(/[\s.]/g, '');
      line = line.slice(0, docMatch.index);
    }
    line = line.replace(/[|_]+/g, ' ').trim();
    const letters = (line.match(/[a-záéíóúüñ]/gi) || []).length;
    if (letters < 3 || line.split(/\s+/).length > 8) continue;

    const suspicious = /[0-9@#$%&*=+<>{}[\]\\/~^?!]/.test(line) || confidence < 70;
    const full = cleanName(line.replace(/[^\p{L}\s'.-]/gu, ' '));
    if (full.split(' ').length < 1 || full.length < 3) continue;
    out.push({ full_name: full, document, flag: suspicious, original: line });
  }
  return out;
}

module.exports = {
  HttpError, localParts, today, isValidDate, addDays, mondayOf, weekDays,
  shortDayLabel, longDateLabel, toMinutes, parseCsv, cleanName, rowsToStudents, linesToStudents
};
