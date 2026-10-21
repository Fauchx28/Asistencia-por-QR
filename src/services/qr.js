// Generación de códigos QR: imagen PNG por estudiante, PDF de carnés para imprimir y ZIP de imágenes.
// El QR contiene solo el token aleatorio del estudiante, nunca datos personales.

function qrPng(token, size = 600) {
  const QRCode = require('qrcode');
  return QRCode.toBuffer(token, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: size });
}

const safeFile = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'archivo';

// Escribe en `stream` un PDF tamaño carta con 12 carnés por página (3 x 4), con líneas de corte.
async function writeCardsPdf(stream, course, students) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 36, info: { Title: `Carnés QR - ${course.name}` } });
  doc.pipe(stream);

  const cols = 3;
  const rows = 4;
  const pageW = doc.page.width - 72;
  const pageH = doc.page.height - 72;
  const cardW = pageW / cols;
  const cardH = pageH / rows;
  const qrSize = Math.min(cardW, cardH) - 64;
  const images = await Promise.all(students.map((s) => qrPng(s.qr_token, 400)));

  students.forEach((s, i) => {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const x = 36 + (slot % cols) * cardW;
    const y = 36 + Math.floor(slot / cols) * cardH;

    doc.save().lineWidth(0.5).dash(3, { space: 3 }).strokeColor('#9AA5A0').rect(x, y, cardW, cardH).stroke().restore();
    doc.image(images[i], x + (cardW - qrSize) / 2, y + 10, { width: qrSize, height: qrSize });
    doc.fillColor('#18262B').font('Helvetica-Bold').fontSize(10)
      .text(s.full_name, x + 8, y + qrSize + 14, { width: cardW - 16, align: 'center', lineBreak: true, height: 26, ellipsis: true });
    doc.fillColor('#56656A').font('Helvetica').fontSize(8)
      .text(`${course.name} · ${s.code}`, x + 8, y + cardH - 18, { width: cardW - 16, align: 'center' });
  });

  if (!students.length) doc.fontSize(14).text('Este curso aún no tiene estudiantes.');
  doc.end();
}

async function writeQrZip(stream, course, students) {
  const archiver = require('archiver');
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.pipe(stream);
  for (const s of students) {
    zip.append(await qrPng(s.qr_token), { name: `${safeFile(course.name)}/${s.code}-${safeFile(s.full_name)}.png` });
  }
  await zip.finalize();
}

module.exports = { qrPng, writeCardsPdf, writeQrZip, safeFile };
