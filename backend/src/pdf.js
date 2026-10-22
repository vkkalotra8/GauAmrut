const PDFDocument = require('pdfkit');

const WATERMARK = 'GauAmrut';

function formatInr(paise = 0) {
  return 'Rs. ' + (paise / 100).toFixed(2);
}

// Standard PDF fonts only encode WinAnsi text. Emoji, hearts and other symbols
// would render as mojibake (e.g. "Jay Dwarkadish 💜" → "Jay DwarkadishØ=Üçø"),
// so keep printable ASCII + Latin-1 + the CP1252 extras and drop the rest.
const CP1252_EXTRAS = '\u20AC\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178\u201A\u201E\u0192\u2026';
function pdfText(value, fallback = '') {
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRAS.includes(ch)) out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out || String(fallback || '');
}

function drawWatermark(doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-30, { origin: [width / 2, height / 2] });
  doc.fillColor('#244d2d').opacity(0.07).font('Helvetica-Bold').fontSize(64)
    .text(WATERMARK, width / 2 - 240, height / 2 - 40, { width: 480, align: 'center', lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

function watermarkAllPages(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawWatermark(doc);
  }
}

function generateBillPdf({ bill, milkman, customer, records = [], payments = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const dairyName = pdfText(milkman?.businessName, 'GauAmrut Dairy Partner');
      const ownerName = pdfText(milkman?.name, 'Dairy Owner');
      const dairyPhone = pdfText(milkman?.phone);
      const dairyUpi = pdfText(milkman?.upiId);
      const customerName = pdfText(customer?.name, 'Valued Customer');
      const customerPhone = pdfText(customer?.phone);
      const customerAddress = pdfText(customer?.address);

      // Header Banner — the dairy's name heads the statement.
      doc.rect(40, 40, 515, 60).fill('#244d2d');
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold')
        .text(dairyName, 55, 52, { width: 330, height: 24, ellipsis: true });
      doc.fontSize(10).font('Helvetica').text('Fresh Pure Milk · Monthly Bill Statement', 55, 76);

      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
        .text(`Month: ${bill.month}`, 400, 54, { align: 'right', width: 140 });
      doc.fontSize(9).font('Helvetica')
        .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 400, 72, { align: 'right', width: 140 });

      // Dairy & Customer Details
      doc.fillColor('#1b261e').fontSize(11).font('Helvetica-Bold').text('Dairy Details', 45, 120);
      doc.fontSize(9).font('Helvetica').fillColor('#4a5568');
      doc.text(dairyName, 45, 136);
      doc.text(`Owner: ${ownerName}`, 45, 150);
      if (dairyPhone) doc.text(`Phone: ${dairyPhone}`, 45, 164);
      if (dairyUpi) doc.text(`UPI: ${dairyUpi}`, 45, 178);

      doc.fillColor('#1b261e').fontSize(11).font('Helvetica-Bold').text('Billed To', 320, 120);
      doc.fontSize(9).font('Helvetica').fillColor('#4a5568');
      doc.text(customerName, 320, 136);
      if (customerPhone) doc.text(`Phone: ${customerPhone}`, 320, 150);
      if (customerAddress) doc.text(`Address: ${customerAddress}`, 320, 164, { width: 230 });

      // Summary Box
      let y = 205;
      doc.rect(40, y, 515, 75).fillAndStroke('#f4f7f2', '#d5e2d1');
      doc.fillColor('#1b261e').fontSize(10).font('Helvetica-Bold');
      doc.text('Opening Balance', 55, y + 14);
      doc.text('Monthly Charges', 180, y + 14);
      doc.text('Payments Received', 315, y + 14);
      doc.text('Net Amount Due', 440, y + 14);

      doc.fontSize(12).font('Helvetica-Bold').fillColor('#244d2d');
      doc.text(formatInr(bill.openingPaise), 55, y + 36);
      doc.text(formatInr(bill.chargesPaise), 180, y + 36);
      doc.fillColor('#2e7424').text(formatInr(bill.paidPaise), 315, y + 36);
      doc.fillColor(bill.closingPaise > 0 ? '#b91c1c' : '#2e7424').text(formatInr(bill.closingPaise), 440, y + 36);

      // Deliveries Section Table
      y = 305;
      doc.fillColor('#1b261e').fontSize(12).font('Helvetica-Bold').text('Delivery Breakdown', 45, y);
      y += 20;

      // Table Header
      doc.rect(40, y, 515, 20).fill('#244d2d');
      doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
      doc.text('Date', 50, y + 5);
      doc.text('Shift', 150, y + 5);
      doc.text('Milk Type', 240, y + 5);
      doc.text('Qty (L)', 330, y + 5);
      doc.text('Rate/L', 410, y + 5);
      doc.text('Total', 485, y + 5, { align: 'right', width: 60 });

      y += 20;
      doc.font('Helvetica').fontSize(8).fillColor('#2d3748');

      const maxRecordsOnPage1 = 20;
      const recordsToDisplay = records.slice(0, maxRecordsOnPage1);

      recordsToDisplay.forEach((r, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f9faf7';
        doc.rect(40, y, 515, 16).fill(bg);
        doc.fillColor('#2d3748');
        doc.text(r.date, 50, y + 4);
        doc.text(r.shift.charAt(0).toUpperCase() + r.shift.slice(1), 150, y + 4);
        doc.text(r.type.charAt(0).toUpperCase() + r.type.slice(1), 240, y + 4);
        doc.text((r.quantityMl / 1000).toFixed(3), 330, y + 4);
        doc.text(formatInr(r.ratePaise), 410, y + 4);
        doc.text(formatInr(r.totalPaise), 485, y + 4, { align: 'right', width: 60 });
        y += 16;
      });

      if (records.length > maxRecordsOnPage1) {
        doc.rect(40, y, 515, 16).fill('#f9faf7');
        doc.fillColor('#718096').text(`... and ${records.length - maxRecordsOnPage1} more deliveries (summary included in total above)`, 50, y + 4);
        y += 16;
      }

      // Payments list if any
      if (payments.length > 0) {
        y += 15;
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fillColor('#1b261e').fontSize(11).font('Helvetica-Bold').text('Payments Credited This Month', 45, y);
        y += 18;

        doc.rect(40, y, 515, 18).fill('#edf3eb');
        doc.fillColor('#244d2d').fontSize(8).font('Helvetica-Bold');
        doc.text('Receipt #', 50, y + 5);
        doc.text('Date', 180, y + 5);
        doc.text('Method', 300, y + 5);
        doc.text('Reference', 390, y + 5);
        doc.text('Amount', 485, y + 5, { align: 'right', width: 60 });
        y += 18;

        doc.font('Helvetica').fontSize(8).fillColor('#2d3748');
        payments.forEach((p, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f9faf7';
          doc.rect(40, y, 515, 16).fill(bg);
          doc.fillColor('#2d3748');
          doc.text(p.receipt || '-', 50, y + 4);
          doc.text(new Date(p.createdAt).toLocaleDateString('en-IN'), 180, y + 4);
          doc.text((p.method || 'UPI').toUpperCase(), 300, y + 4);
          doc.text(pdfText(p.reference, '-'), 390, y + 4);
          doc.text(formatInr(p.amountPaise), 485, y + 4, { align: 'right', width: 60 });
          y += 16;
        });
      }

      // Footer
      const footerY = 770;
      doc.rect(40, footerY, 515, 1).fill('#cbd5e0');
      doc.fontSize(8).fillColor('#718096').font('Helvetica')
        .text('GauAmrut Platform · Thank you for supporting your local fresh milk dairy.', 40, footerY + 8, { align: 'center', width: 515 });

      watermarkAllPages(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Generic paginated table report (deliveries, payments, customers, orders).
// Every dynamic string goes through pdfText; the project name is watermarked.
function generateReportPdf({ title, dairyName, period, subtitle = '', columns = [], rows = [], summary = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const rowH = 16;
      let y = 0;

      const drawHeader = (continued = false) => {
        doc.rect(40, 40, 515, 60).fill('#244d2d');
        doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
          .text(pdfText(dairyName, 'GauAmrut Dairy'), 55, 50, { width: 330, height: 22, ellipsis: true });
        doc.fontSize(10).font('Helvetica')
          .text(pdfText(title) + (continued ? ' (continued)' : ''), 55, 74, { width: 330, height: 14, ellipsis: true });
        if (period) {
          doc.fontSize(10).font('Helvetica-Bold').text(`Period: ${pdfText(period)}`, 395, 54, { align: 'right', width: 145 });
        }
        doc.fontSize(8).font('Helvetica')
          .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 395, period ? 70 : 60, { align: 'right', width: 145 });

        y = 120;
        if (subtitle) {
          doc.fillColor('#4a5568').fontSize(9).font('Helvetica').text(pdfText(subtitle), 45, y, { width: 505 });
          y += 18;
        }
        doc.rect(40, y, 515, 20).fill('#244d2d');
        doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
        let x = 48;
        for (const col of columns) {
          doc.text(pdfText(col.label), x, y + 6, { width: col.width - 8, align: col.align || 'left', height: 10, ellipsis: true });
          x += col.width;
        }
        y += 20;
      };

      drawHeader();

      rows.forEach((row, idx) => {
        if (y + rowH > 765) {
          doc.addPage();
          drawHeader(true);
        }
        doc.rect(40, y, 515, rowH).fill(idx % 2 === 0 ? '#ffffff' : '#f9faf7');
        let x = 48;
        columns.forEach((col, ci) => {
          const raw = row[ci];
          const cell = typeof raw === 'number' ? String(raw) : pdfText(raw);
          doc.fillColor('#2d3748').fontSize(8).font('Helvetica')
            .text(cell, x, y + 4, { width: col.width - 8, align: col.align || 'left', height: 10, ellipsis: true });
          x += col.width;
        });
        y += rowH;
      });

      if (summary.length) {
        y += 14;
        if (y + summary.length * 16 > 765) { doc.addPage(); drawHeader(true); }
        doc.fillColor('#1b261e').fontSize(9.5).font('Helvetica-Bold');
        summary.forEach(line => { doc.text(pdfText(line), 45, y, { width: 505 }); y += 16; });
      }

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(40, 782, 515, 1).fill('#cbd5e0');
        doc.fillColor('#718096').fontSize(8).font('Helvetica')
          .text(`${WATERMARK} · Page ${i - range.start + 1} of ${range.count}`, 40, 790, { align: 'center', width: 515 });
        drawWatermark(doc);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateBillPdf, generateReportPdf, pdfText, formatInr };
