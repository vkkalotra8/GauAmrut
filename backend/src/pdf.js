const path = require('path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');

const WATERMARK = 'GauAmrut';
const PDF_COLORS = Object.freeze({
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySoft: '#DBEAFE',
  foreground: '#0F172A',
  cellForeground: '#334155',
  mutedForeground: '#5F6B7A',
  background: '#F8FAFC',
  border: '#E2E8F0',
  success: '#15803D',
  destructive: '#B91C1C',
  warning: '#A16207',
  pending: '#7C3AED'
});

// The core-14 PDF fonts (Helvetica, Times, Courier) only encode WinAnsi text,
// so a name like "Jay Dwarkadish 💜" or "ગૌ અમૃત" would come out as mojibake or
// blank boxes. To draw those properly we embed open-licensed faces and choose
// per string:
//   * plain WinAnsi text  -> the core-14 face the layout already asked for, so
//     ordinary reports keep their existing look, stay small, and keep real,
//     searchable text in the content stream;
//   * anything else       -> Noto Sans for Latin and the ₹ symbol, Noto Sans
//     Devanagari / Gujarati for the Indian scripts the app ships in, and Noto
//     Emoji for emoji codepoints.
// Nirmala UI and the Segoe UI emoji faces ship with Windows and are NOT
// redistributable, so only OFL / Apache-2.0 fonts are bundled here — see
// assets/fonts/README.md.
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSans-Bold.ttf');
const FONT_DEVA = path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf');
const FONT_DEVA_BOLD = path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf');
const FONT_GUJ = path.join(FONT_DIR, 'NotoSansGujarati-Regular.ttf');
const FONT_GUJ_BOLD = path.join(FONT_DIR, 'NotoSansGujarati-Bold.ttf');
const FONT_EMOJI = path.join(FONT_DIR, 'NotoEmoji-Regular.ttf');
const FONT_SYMBOLS = path.join(FONT_DIR, 'NotoSansSymbols-Regular.ttf');
const FONT_SYMBOLS_2 = path.join(FONT_DIR, 'NotoSansSymbols2-Regular.ttf');
const FONT_MATH = path.join(FONT_DIR, 'NotoSansMath-Regular.ttf');

// Core-14 face -> the embedded Unicode face used in its place when a string
// carries characters WinAnsi cannot encode. Bold maps to the bold cut so
// headings keep their weight.
const STD_FONTS = {
  Helvetica: 'GA-Latin',
  'Helvetica-Bold': 'GA-Latin-Bold',
  Times: 'GA-Latin',
  'Times-Bold': 'GA-Latin-Bold',
  Courier: 'GA-Latin',
  'Courier-Bold': 'GA-Latin-Bold'
};
const EMBEDDED_FONTS = ['GA-Latin', 'GA-Latin-Bold', 'GA-Deva', 'GA-Deva-Bold', 'GA-Guj', 'GA-Guj-Bold', 'GA-Symbols', 'GA-Symbols-2', 'GA-Math', 'GA-Emoji'];

const FONT_COVERAGE = {
  'GA-Latin': fontkit.openSync(FONT_REGULAR),
  'GA-Latin-Bold': fontkit.openSync(FONT_BOLD),
  'GA-Deva': fontkit.openSync(FONT_DEVA),
  'GA-Deva-Bold': fontkit.openSync(FONT_DEVA_BOLD),
  'GA-Guj': fontkit.openSync(FONT_GUJ),
  'GA-Guj-Bold': fontkit.openSync(FONT_GUJ_BOLD),
  'GA-Symbols': fontkit.openSync(FONT_SYMBOLS),
  'GA-Symbols-2': fontkit.openSync(FONT_SYMBOLS_2),
  'GA-Math': fontkit.openSync(FONT_MATH),
  'GA-Emoji': fontkit.openSync(FONT_EMOJI)
};

// Per-script cuts. Only Devanagari and Gujarati get their own faces because
// they are the only Indic scripts this product ships (hi / gu); a codepoint
// outside them falls back to pdfText() dropping it rather than drawing a tofu
// box, which is what the WinAnsi-only path did too.
const SCRIPT_FACES = {
  deva: { regular: 'GA-Deva', bold: 'GA-Deva-Bold' },
  guj: { regular: 'GA-Guj', bold: 'GA-Guj-Bold' }
};

function registerFonts(doc) {
  doc.registerFont('GA-Latin', FONT_REGULAR);
  doc.registerFont('GA-Latin-Bold', FONT_BOLD);
  doc.registerFont('GA-Deva', FONT_DEVA);
  doc.registerFont('GA-Deva-Bold', FONT_DEVA_BOLD);
  doc.registerFont('GA-Guj', FONT_GUJ);
  doc.registerFont('GA-Guj-Bold', FONT_GUJ_BOLD);
  doc.registerFont('GA-Symbols', FONT_SYMBOLS);
  doc.registerFont('GA-Symbols-2', FONT_SYMBOLS_2);
  doc.registerFont('GA-Math', FONT_MATH);
  doc.registerFont('GA-Emoji', FONT_EMOJI);
}

// pdfkit has no per-glyph font fallback: it lays a whole string through a
// single face. So drawText() decides the face, and we only need doc.font() to
// remember which face the caller last asked for. `_gaStd` is that request
// (drawn as-is when the text is plain); `_gaNative` is what pdfkit is actually
// showing right now, so we can skip redundant switches and always hand the
// document back in the state the surrounding code expects.
function patchFonts(doc) {
  registerFonts(doc);
  const original = doc.font.bind(doc);
  doc._gaStd = 'Helvetica';
  doc._gaUni = STD_FONTS.Helvetica;
  doc._gaNative = 'Helvetica';
  doc.font = (src, ...rest) => {
    if (typeof src === 'string') {
      if (STD_FONTS[src]) {
        doc._gaStd = src;
        doc._gaUni = STD_FONTS[src];
        doc._gaNative = src;
      } else if (EMBEDDED_FONTS.includes(src)) {
        doc._gaUni = src;
        doc._gaNative = src;
      }
    }
    return original(src, ...rest);
  };
}

// WinAnsi (CP1252): everything the core-14 fonts can encode. Codepoints
// outside this set need an embedded face.
const CP1252_EXTRAS = new Set(Array.from('\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178', c => c.codePointAt(0)));
function isWinAnsiCp(cp) {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRAS.has(cp);
}
function isWinAnsi(str) {
  for (const ch of str) if (!isWinAnsiCp(ch.codePointAt(0))) return false;
  return true;
}

const inRange = (cp, lo, hi) => cp >= lo && cp <= hi;
const isDevanagariCp = cp => inRange(cp, 0x0900, 0x097f);
const isGujaratiCp = cp => inRange(cp, 0x0a80, 0x0aff);
// Variation selectors and joiners decorate whatever precedes them, so they
// inherit the previous run's face rather than splitting it (❤ + FE0F stays one
// emoji run; a ZWJ inside a Gujarati conjunct stays in the Gujarati run).
const isJoinerCp = cp => cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f);
const isEmojiModifierCp = cp => cp >= 0x1f3fb && cp <= 0x1f3ff;

// Ask the actual bundled fonts instead of maintaining a fragile codepoint
// allow-list. This keeps symbols and newly added glyphs from being discarded.
function supports(face, cp) {
  return Boolean(FONT_COVERAGE[face]?.hasGlyphForCodePoint(cp));
}

function renderableCp(cp) {
  return isJoinerCp(cp) || Object.values(FONT_COVERAGE).some(font => font.hasGlyphForCodePoint(cp));
}

// Whitespace never needs a glyph: it collapses to a single space below. Only
// everything else has to be something an embedded face can draw.
const WHITESPACE = /\s/;

// Normalise a value for what we can draw: collapse whitespace and drop control
// characters. Unknown printable codepoints become U+FFFD so user data never
// disappears silently from a generated document.
function pdfText(value, fallback = '') {
  let drawn = '';
  for (const ch of String(value ?? '')) {
    if (WHITESPACE.test(ch)) {
      drawn += ch;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) continue;
    if (renderableCp(cp)) drawn += ch;
    else if (!isEmojiModifierCp(cp)) drawn += '\uFFFD';
  }
  const cleaned = drawn.replace(/\s+/g, ' ').trim();
  return cleaned || String(fallback || '');
}

// Emoji and pictographs (the ranges Noto Emoji covers).
function isEmojiCp(cp) {
  return (cp >= 0x1f000 && cp <= 0x1ffff)  // emoji, flags, skin tones, symbols & pictographs
    || (cp >= 0x2600 && cp <= 0x27bf)      // misc symbols & dingbats (❤ ✅ ❌ …)
    || (cp >= 0x2b00 && cp <= 0x2bff);     // misc symbols & arrows
}

// Which embedded face owns a codepoint: emoji go to Noto Emoji, the Indic
// scripts to their own Noto cut (bold for bold runs), everything else to the
// Noto Sans face the caller's core-14 font mapped to.
function faceFor(cp, baseFont) {
  if (isEmojiCp(cp) && supports('GA-Emoji', cp)) return 'GA-Emoji';
  const script = isDevanagariCp(cp) ? 'deva' : isGujaratiCp(cp) ? 'guj' : null;
  if (script) {
    const faces = SCRIPT_FACES[script];
    return baseFont.endsWith('Bold') ? faces.bold : faces.regular;
  }
  if (supports(baseFont, cp)) return baseFont;
  if (supports('GA-Symbols', cp)) return 'GA-Symbols';
  if (supports('GA-Symbols-2', cp)) return 'GA-Symbols-2';
  if (supports('GA-Math', cp)) return 'GA-Math';
  if (supports('GA-Emoji', cp)) return 'GA-Emoji';
  return baseFont;
}

function emojiInk(text) {
  if (/[\u{1F49C}\u{1F7E3}]/u.test(text)) return PDF_COLORS.pending;
  if (/[\u2764\u{1F9E1}\u{1F534}]/u.test(text)) return PDF_COLORS.destructive;
  if (/[\u{1F49A}\u{1F7E2}]/u.test(text)) return PDF_COLORS.success;
  if (/[\u{1F499}\u{1F535}]/u.test(text)) return PDF_COLORS.primary;
  if (/[\u{1F49B}\u{1F7E1}]/u.test(text)) return PDF_COLORS.warning;
  return PDF_COLORS.primaryDark;
}

// Split a string into runs of a single face: { text, font }[]. Consecutive
// codepoints sharing a face form one run so shaping within a script survives.
function splitRuns(value, baseFont) {
  const runs = [];
  let cur = null;
  let previous = null;
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    const font = isJoinerCp(cp) && previous ? previous : faceFor(cp, baseFont);
    previous = font;
    if (!cur || cur.font !== font) {
      cur = { text: ch, font };
      runs.push(cur);
    } else {
      cur.text += ch;
    }
  }
  return runs;
}

function formatInr(paise = 0) {
  return '\u20B9 ' + (paise / 100).toFixed(2);
}

// Lay a mixed-face string ourselves so the segments sit side by side in the
// right place. pdfkit can only measure and position one face per call, so for
// each run we ask it where the run starts (align) and how wide it is, then
// place every run at an explicit x. Single-run strings are handed straight
// back to pdfkit, which then keeps its own wrapping and ellipsis behaviour.
function drawRuns(doc, str, baseFont, x, y, options = {}) {
  const runs = splitRuns(str, baseFont);
  if (!runs.length) return doc;
  if (runs.length === 1) {
    const run = runs[0];
    if (run.font === 'GA-Emoji') {
      doc.save().fillColor(emojiInk(run.text)).font(run.font).text(run.text, x, y, options).restore();
      return doc;
    }
    return doc.font(run.font).text(run.text, x, y, options);
  }

  const size = doc._fontSize;
  const widths = runs.map(r => doc.font(r.font).widthOfString(r.text, size));
  let total = widths.reduce((a, b) => a + b, 0);
  const width = options.width;

  // Clip to the column with an ellipsis so a long name reads as truncated
  // rather than spilling into the neighbouring cell.
  if (width && total > width) {
    const ellipsis = '\u2026';
    const budget = Math.max(0, width - doc.font(baseFont).widthOfString(ellipsis, size));
    const clipped = [];
    let used = 0;
    for (let i = 0; i < runs.length && used < budget; i++) {
      if (used + widths[i] <= budget) {
        clipped.push(runs[i]);
        used += widths[i];
        continue;
      }
      let piece = '';
      let pieceW = 0;
      for (const ch of runs[i].text) {
        const cw = doc.font(runs[i].font).widthOfString(ch, size);
        if (used + pieceW + cw > budget) break;
        piece += ch;
        pieceW += cw;
      }
      if (piece) {
        clipped.push({ text: piece, font: runs[i].font });
        used += pieceW;
      }
      break;
    }
    clipped.push({ text: ellipsis, font: baseFont });
    runs.length = 0;
    runs.push(...clipped);
    for (let i = 0; i < runs.length; i++) widths[i] = doc.font(runs[i].font).widthOfString(runs[i].text, size);
    total = widths.reduce((a, b) => a + b, 0);
  }

  let startX = x;
  const align = options.align || 'left';
  if (align === 'right') startX = x + (width || total) - total;
  else if (align === 'center') startX = x + ((width || total) - total) / 2;

  // Each run is drawn on its own line at an explicit x, so drop the layout
  // options pdfkit would otherwise try to re-apply per run.
  const runOptions = { ...options, lineBreak: false };
  delete runOptions.width;
  delete runOptions.height;
  delete runOptions.align;
  delete runOptions.ellipsis;

  let cursor = startX;
  runs.forEach((run, i) => {
    if (run.font === 'GA-Emoji') {
      doc.save().fillColor(emojiInk(run.text)).font(run.font).text(run.text, cursor, y, runOptions).restore();
    } else {
      doc.font(run.font).text(run.text, cursor, y, runOptions);
    }
    cursor += widths[i];
  });
  return doc;
}

// Drop-in replacement for doc.text(value, x, y, options) that renders emoji,
// ₹ and Indian scripts instead of dropping them on the floor.
function drawText(doc, value, x, y, options = {}) {
  const str = pdfText(value);
  if (!str) return doc;
  const stdFont = doc._gaStd || 'Helvetica';

  if (isWinAnsi(str)) {
    // Plain text: keep the core-14 face the layout asked for. No font
    // embedding, real text in the content stream, unchanged appearance.
    if (doc._gaNative !== stdFont) doc.font(stdFont);
    return doc.text(str, x, y, options);
  }

  const uniFont = doc._gaUni || STD_FONTS[stdFont] || 'GA-Latin';
  try {
    return drawRuns(doc, str, uniFont, x, y, options);
  } finally {
    // Hand the document back with the face the caller requested, so the next
    // plain doc.text() still draws in Helvetica/Helvetica-Bold.
    if (doc._gaNative !== stdFont) doc.font(stdFont);
  }
}

function drawWatermark(doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-30, { origin: [width / 2, height / 2] });
  doc.fillColor(PDF_COLORS.primary).opacity(0.06).font('Helvetica-Bold').fontSize(64);
  drawText(doc, WATERMARK, width / 2 - 240, height / 2 - 40, { width: 480, align: 'center', lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

function generateBillPdf({ bill, milkman, customer, records = [], payments = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      patchFonts(doc);
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
      doc.rect(40, 40, 515, 60).fill(PDF_COLORS.primary);
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold');
      drawText(doc, dairyName, 55, 52, { width: 330, height: 24, ellipsis: true });
      doc.fontSize(10).font('Helvetica');
      drawText(doc, 'Fresh Pure Milk \u00B7 Monthly Bill Statement', 55, 76);

      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold');
      drawText(doc, `Month: ${bill.month}`, 400, 54, { align: 'right', width: 140 });
      doc.fontSize(9).font('Helvetica');
      drawText(doc, `Generated: ${new Date().toLocaleDateString('en-IN')}`, 400, 72, { align: 'right', width: 140 });
      if (bill.provisional) {
        doc.fillColor(PDF_COLORS.warning).fontSize(8).font('Helvetica-Bold');
        drawText(doc, 'TILL-DATE STATEMENT \u00B7 Month in progress', 55, 90, { width: 330 });
      }

      // Dairy & Customer Details
      doc.fillColor(PDF_COLORS.foreground).fontSize(11).font('Helvetica-Bold');
      drawText(doc, 'Dairy Details', 45, 120);
      doc.fontSize(9).font('Helvetica').fillColor(PDF_COLORS.mutedForeground);
      drawText(doc, dairyName, 45, 136);
      drawText(doc, `Owner: ${ownerName}`, 45, 150);
      if (dairyPhone) drawText(doc, `Phone: ${dairyPhone}`, 45, 164);
      if (dairyUpi) drawText(doc, `UPI: ${dairyUpi}`, 45, 178);

      doc.fillColor(PDF_COLORS.foreground).fontSize(11).font('Helvetica-Bold');
      drawText(doc, 'Billed To', 320, 120);
      doc.fontSize(9).font('Helvetica').fillColor(PDF_COLORS.mutedForeground);
      drawText(doc, customerName, 320, 136);
      if (customerPhone) drawText(doc, `Phone: ${customerPhone}`, 320, 150);
      if (customerAddress) drawText(doc, `Address: ${customerAddress}`, 320, 164, { width: 230 });

      // Summary Box
      let y = 205;
      doc.rect(40, y, 515, 75).fillAndStroke(PDF_COLORS.background, PDF_COLORS.border);
      doc.fillColor(PDF_COLORS.foreground).fontSize(10).font('Helvetica-Bold');
      drawText(doc, 'Opening Balance', 55, y + 14);
      drawText(doc, 'Monthly Charges', 180, y + 14);
      drawText(doc, 'Payments Received', 315, y + 14);
      drawText(doc, 'Net Amount Due', 440, y + 14);

      doc.fontSize(12).font('Helvetica-Bold').fillColor(PDF_COLORS.primaryDark);
      drawText(doc, formatInr(bill.openingPaise), 55, y + 36);
      drawText(doc, formatInr(bill.chargesPaise), 180, y + 36);
      doc.fillColor(PDF_COLORS.success);
      drawText(doc, formatInr(bill.paidPaise), 315, y + 36);
      doc.fillColor(bill.closingPaise > 0 ? PDF_COLORS.destructive : PDF_COLORS.success);
      drawText(doc, formatInr(bill.closingPaise), 440, y + 36);

      // Deliveries Section Table
      y = 305;
      doc.fillColor(PDF_COLORS.foreground).fontSize(12).font('Helvetica-Bold');
      drawText(doc, 'Delivery Breakdown', 45, y);
      y += 20;

      const drawDeliveryHeader = (continued = false) => {
        if (continued) {
          doc.fillColor(PDF_COLORS.foreground).fontSize(11).font('Helvetica-Bold');
          drawText(doc, 'Delivery Breakdown (continued)', 45, y);
          y += 18;
        }
        doc.rect(40, y, 515, 20).fill(PDF_COLORS.primary);
        doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
        drawText(doc, 'Date', 50, y + 5);
        drawText(doc, 'Shift', 150, y + 5);
        drawText(doc, 'Milk Type', 240, y + 5);
        drawText(doc, 'Qty (L)', 330, y + 5);
        drawText(doc, 'Rate/L', 410, y + 5);
        drawText(doc, 'Total', 485, y + 5, { align: 'right', width: 60 });
        y += 20;
      };

      drawDeliveryHeader();
      records.forEach((r, idx) => {
        if (y + 16 > 760) {
          doc.addPage();
          y = 50;
          drawDeliveryHeader(true);
        }
        const bg = idx % 2 === 0 ? '#ffffff' : PDF_COLORS.background;
        doc.rect(40, y, 515, 16).fill(bg);
        doc.fillColor(PDF_COLORS.cellForeground).font('Helvetica').fontSize(8);
        drawText(doc, r.date, 50, y + 4);
        drawText(doc, pdfText(r.shift).replace(/^./, c => c.toUpperCase()), 150, y + 4);
        drawText(doc, pdfText(r.type).replace(/^./, c => c.toUpperCase()), 240, y + 4);
        drawText(doc, (r.quantityMl / 1000).toFixed(3), 330, y + 4);
        drawText(doc, formatInr(r.ratePaise), 410, y + 4);
        drawText(doc, formatInr(r.totalPaise), 485, y + 4, { align: 'right', width: 60 });
        y += 16;
      });

      // Payments list if any
      if (payments.length > 0) {
        y += 15;
        const paymentSectionStartHeight = 36 + Math.min(payments.length, 3) * 16;
        if (y + paymentSectionStartHeight > 760) { doc.addPage(); y = 50; }
        const drawPaymentHeader = (continued = false) => {
          doc.fillColor(PDF_COLORS.foreground).fontSize(11).font('Helvetica-Bold');
          drawText(doc, `Payments Credited This Month${continued ? ' (continued)' : ''}`, 45, y);
          y += 18;
          doc.rect(40, y, 515, 18).fill(PDF_COLORS.primarySoft);
          doc.fillColor(PDF_COLORS.primaryDark).fontSize(8).font('Helvetica-Bold');
          drawText(doc, 'Receipt #', 50, y + 5);
          drawText(doc, 'Date', 180, y + 5);
          drawText(doc, 'Method', 300, y + 5);
          drawText(doc, 'Reference', 390, y + 5);
          drawText(doc, 'Amount', 485, y + 5, { align: 'right', width: 60 });
          y += 18;
        };
        drawPaymentHeader();
        payments.forEach((p, idx) => {
          if (y + 16 > 760) {
            doc.addPage();
            y = 50;
            drawPaymentHeader(true);
          }
          const bg = idx % 2 === 0 ? '#ffffff' : PDF_COLORS.background;
          doc.rect(40, y, 515, 16).fill(bg);
          doc.fillColor(PDF_COLORS.cellForeground).font('Helvetica').fontSize(8);
          drawText(doc, p.receipt || '-', 50, y + 4);
          drawText(doc, new Date(p.createdAt).toLocaleDateString('en-IN'), 180, y + 4);
          drawText(doc, (p.method || 'UPI').toUpperCase(), 300, y + 4);
          drawText(doc, pdfText(p.reference, '-'), 390, y + 4);
          drawText(doc, formatInr(p.amountPaise), 485, y + 4, { align: 'right', width: 60 });
          y += 16;
        });
      }

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(40, 778, 515, 1).fill(PDF_COLORS.border);
        doc.fontSize(8).fillColor(PDF_COLORS.mutedForeground).font('Helvetica');
        drawText(doc, `GauAmrut Platform \u00B7 Page ${i - range.start + 1} of ${range.count} \u00B7 Thank you for supporting your local dairy.`, 40, 787, { align: 'center', width: 515 });
        drawWatermark(doc);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Generic paginated table report (deliveries, payments, customers, orders).
// Every dynamic string goes through drawText so emoji and Indic names render;
// the project name is watermarked.
function generateReportPdf({ title, dairyName, period, subtitle = '', columns = [], rows = [], summary = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      patchFonts(doc);
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const rowH = 16;
      let y = 0;

      const drawHeader = (continued = false) => {
        doc.rect(40, 40, 515, 60).fill(PDF_COLORS.primary);
        doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold');
        drawText(doc, pdfText(dairyName, 'GauAmrut Dairy'), 55, 50, { width: 330, height: 22, ellipsis: true });
        doc.fontSize(10).font('Helvetica');
        drawText(doc, pdfText(title) + (continued ? ' (continued)' : ''), 55, 74, { width: 330, height: 14, ellipsis: true });
        if (period) {
          doc.fontSize(10).font('Helvetica-Bold');
          drawText(doc, `Period: ${pdfText(period)}`, 395, 54, { align: 'right', width: 145 });
        }
        doc.fontSize(8).font('Helvetica');
        drawText(doc, `Generated: ${new Date().toLocaleDateString('en-IN')}`, 395, period ? 70 : 60, { align: 'right', width: 145 });

        y = 120;
        if (subtitle) {
          doc.fillColor(PDF_COLORS.mutedForeground).fontSize(9).font('Helvetica');
          drawText(doc, subtitle, 45, y, { width: 505 });
          y += 18;
        }
        doc.rect(40, y, 515, 20).fill(PDF_COLORS.primary);
        doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
        let x = 48;
        for (const col of columns) {
          drawText(doc, col.label, x, y + 6, { width: col.width - 8, align: col.align || 'left', height: 10, ellipsis: true });
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
        doc.rect(40, y, 515, rowH).fill(idx % 2 === 0 ? '#ffffff' : PDF_COLORS.background);
        let x = 48;
        columns.forEach((col, ci) => {
          const raw = row[ci];
          const cell = typeof raw === 'number' ? String(raw) : pdfText(raw);
          doc.fillColor(PDF_COLORS.cellForeground).fontSize(8).font('Helvetica');
          drawText(doc, cell, x, y + 4, { width: col.width - 8, align: col.align || 'left', height: 10, ellipsis: true });
          x += col.width;
        });
        y += rowH;
      });

      if (summary.length) {
        y += 14;
        if (y + summary.length * 16 > 765) { doc.addPage(); drawHeader(true); }
        doc.fillColor(PDF_COLORS.foreground).fontSize(9.5).font('Helvetica-Bold');
        summary.forEach(line => { drawText(doc, line, 45, y, { width: 505 }); y += 16; });
      }

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(40, 782, 515, 1).fill(PDF_COLORS.border);
        doc.fillColor(PDF_COLORS.mutedForeground).fontSize(8).font('Helvetica');
        drawText(doc, `${WATERMARK} \u00B7 Page ${i - range.start + 1} of ${range.count}`, 40, 790, { align: 'center', width: 515 });
        drawWatermark(doc);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateBillPdf, generateReportPdf, pdfText, drawText, formatInr };
