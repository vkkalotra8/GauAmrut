const PDFDocument = require('pdfkit');

function formatInr(paise = 0) {
  return 'Rs. ' + (paise / 100).toFixed(2);
}

function generateBillPdf({ bill, milkman, customer, records = [], payments = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header Banner
      doc.rect(40, 40, 515, 60).fill('#244d2d');
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('GAUAMRUT', 55, 52);
      doc.fontSize(10).font('Helvetica').text('Fresh Pure Milk · Monthly Bill Statement', 55, 76);

      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
        .text(`Month: ${bill.month}`, 400, 54, { align: 'right', width: 140 });
      doc.fontSize(9).font('Helvetica')
        .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 400, 72, { align: 'right', width: 140 });

      // Dairy & Customer Details
      doc.fillColor('#1b261e').fontSize(11).font('Helvetica-Bold').text('Dairy Details', 45, 120);
      doc.fontSize(9).font('Helvetica').fillColor('#4a5568');
      doc.text(milkman?.businessName || 'GauAmrut Dairy Partner', 45, 136);
      doc.text(`Owner: ${milkman?.name || 'Dairy Owner'}`, 45, 150);
      if (milkman?.phone) doc.text(`Phone: ${milkman.phone}`, 45, 164);
      if (milkman?.upiId) doc.text(`UPI: ${milkman.upiId}`, 45, 178);

      doc.fillColor('#1b261e').fontSize(11).font('Helvetica-Bold').text('Billed To', 320, 120);
      doc.fontSize(9).font('Helvetica').fillColor('#4a5568');
      doc.text(customer?.name || 'Valued Customer', 320, 136);
      if (customer?.phone) doc.text(`Phone: ${customer.phone}`, 320, 150);
      if (customer?.address) doc.text(`Address: ${customer.address}`, 320, 164, { width: 230 });

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
          doc.text(p.reference || '-', 390, y + 4);
          doc.text(formatInr(p.amountPaise), 485, y + 4, { align: 'right', width: 60 });
          y += 16;
        });
      }

      // Footer
      const footerY = 770;
      doc.rect(40, footerY, 515, 1).fill('#cbd5e0');
      doc.fontSize(8).fillColor('#718096').font('Helvetica')
        .text('GauAmrut Platform · Thank you for supporting your local fresh milk dairy.', 40, footerY + 8, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateBillPdf };
