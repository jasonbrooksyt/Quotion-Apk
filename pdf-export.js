/* pdf-export.js — builds a print-ready A4 quotation PDF using jsPDF (vendored, offline).
   Layout mirrors the company's existing invoice format: one continuous bordered
   header box (title / company / GSTIN+Mobile / Quotation No.+Date / To / Ref+Validity),
   then a bordered item table, then a totals box + Amount in Words bar + signatory. */

const PdfExport = (function () {

  const PAGE_W = 210, PAGE_H = 297; // mm
  const MARGIN = 12;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const MIDX = MARGIN + CONTENT_W / 2;

  function generate(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    let y = MARGIN;
    y = drawHeaderBox(doc, data, y);
    y = drawItemsTable(doc, data, y);

    // Push totals/terms/signature down so the quotation fills the A4 page
    const bottomH = estimateBottomHeight(data);
    const minY = PAGE_H - MARGIN - bottomH;
    if (y < minY) y = minY;

    y = drawTotalsAndWords(doc, data, y);
    y = drawTermsAndSignature(doc, data, y);

    const filename = `Quotation_${(data.meta.quoteNo || 'draft').replace(/[^\w-]/g, '_')}.pdf`;
    const blob = doc.output('blob');
    FileSaver.saveOrShare(blob, filename, 'application/pdf').then((res) => {
      if (res.method === 'failed') {
        QGenApp.toast('PDF export failed — try again or check storage permission');
      } else if (res.method === 'cancelled') {
        // user closed share sheet, no message needed
      } else {
        QGenApp.toast(res.method === 'share' ? 'PDF ready to save/share' : 'PDF downloaded');
      }
    });
  }

  function ensureSpace(doc, y, needed) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      return MARGIN;
    }
    return y;
  }

  // ---- Bordered header box, styled after the company's existing invoice format ----

  function hLine(doc, y) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  }
  function vLine(doc, y0, y1) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    doc.line(MIDX, y0, MIDX, y1);
  }

  function twoColRow(doc, y, h, leftText, rightText, opts = {}) {
    doc.setFontSize(opts.size || 9);
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.text(leftText, MARGIN + 2, y + h / 2 + 1.3);
    doc.text(rightText, MARGIN + CONTENT_W - 2, y + h / 2 + 1.3, { align: 'right' });
    vLine(doc, y, y + h);
    doc.setFont(undefined, 'normal');
    return y + h;
  }

  function drawHeaderBox(doc, data, y) {
    const boxTop = y;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);

    // Row: QUOTATION title bar
    const rTitleH = 8;
    doc.setFillColor(245, 247, 250);
    doc.rect(MARGIN, y, CONTENT_W, rTitleH, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text('QUOTATION', PAGE_W / 2, y + rTitleH / 2 + 1.6, { align: 'center' });
    y += rTitleH;
    hLine(doc, y);

    // Row: Logo + Company name + address (one merged block, like the invoice)
    const rBrandH = 20;
    const logoSize = 16;
    if (typeof LOGO_DATA_URI !== 'undefined' && LOGO_DATA_URI) {
      try {
        doc.addImage(LOGO_DATA_URI, 'JPEG', MARGIN + 3, y + (rBrandH - logoSize) / 2, logoSize, logoSize);
      } catch (e) {
        // if the image fails to embed for any reason, keep going without it
      }
    }
    doc.setFont(undefined, 'bold');
    doc.setFontSize(14);
    doc.setTextColor(26, 61, 156);
    doc.text(data.company.name || 'Company Name', PAGE_W / 2, y + 9, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    doc.text(data.company.address || '', PAGE_W / 2, y + 15, { align: 'center', maxWidth: CONTENT_W - 46 });
    y += rBrandH;
    hLine(doc, y);

    // Row: GSTIN Number / Mobile Number
    y = twoColRowLeftLabel(doc, y, 7, `GSTIN Number :- ${data.company.gstin || ''}`, `Mobile Number :- ${data.company.phone || ''}`, { bold: true, size: 9 });
    hLine(doc, y);

    // Row: Quotation No. / Date
    y = twoColRowLeftLabel(doc, y, 7, `Quotation No.: ${data.meta.quoteNo || ''}`, `Date :- ${Utils.formatDateDMY(data.meta.date)}`, { bold: true, size: 9 });
    hLine(doc, y);

    // Row: Bill To block (multi-line, left aligned, full width)
    const billLines = [];
    billLines.push({ text: 'To,', bold: true });
    if (data.customer.name) billLines.push({ text: data.customer.name, bold: true });
    if (data.customer.address) {
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(data.customer.address, CONTENT_W * 0.55);
      wrapped.forEach((l) => billLines.push({ text: l, bold: false }));
    }
    if (data.customer.gstin) billLines.push({ text: `GSTIN :- ${data.customer.gstin}`, bold: false });
    if (data.customer.contact) billLines.push({ text: `Kind Attn.: ${data.customer.contact}`, bold: false });
    if (data.meta.subject) {
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(`Subject: ${data.meta.subject}`, CONTENT_W - 4);
      wrapped.forEach((l, i) => billLines.push({ text: l, bold: i === 0 }));
    }

    const rBillH = Math.max(9, billLines.length * 4.3 + 3);
    let ly = y + 4;
    billLines.forEach((l) => {
      doc.setFont(undefined, l.bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.text(l.text, MARGIN + 2, ly);
      ly += 4.3;
    });
    doc.setFont(undefined, 'normal');
    y += rBillH;
    hLine(doc, y);

    // Outer border around the whole header box
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, boxTop, CONTENT_W, y - boxTop);

    return y;
  }

  function twoColRowLeftLabel(doc, y, h, leftText, rightText, opts = {}) {
    doc.setFontSize(opts.size || 9);
    doc.setFont(undefined, opts.bold ? 'bold' : 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(leftText, MARGIN + 2, y + h / 2 + 1.3);
    doc.text(rightText, MARGIN + CONTENT_W - 2, y + h / 2 + 1.3, { align: 'right' });
    vLine(doc, y, y + h);
    doc.setFont(undefined, 'normal');
    return y + h;
  }

  // ---- Item table ----

  // Column layout (mm), total = CONTENT_W (186)
  const COLS = [
    { key: 'sno', label: 'Sr.No.', w: 10, align: 'center' },
    { key: 'desc', label: 'Material / Service Description', w: 64, align: 'left' },
    { key: 'hsn', label: 'HSN/SAC', w: 16, align: 'center' },
    { key: 'qty', label: 'Qty.', w: 12, align: 'center' },
    { key: 'rate', label: 'Unit Rate', w: 18, align: 'right' },
    { key: 'disc', label: 'Disc.%', w: 12, align: 'center' },
    { key: 'gst', label: 'GST%', w: 12, align: 'center' },
    { key: 'gstAmt', label: 'GST Amt', w: 18, align: 'right' },
    { key: 'total', label: 'Amount', w: 24, align: 'right' },
  ];

  function colX(idx) {
    let x = MARGIN;
    for (let i = 0; i < idx; i++) x += COLS[i].w;
    return x;
  }

  function drawTableHeader(doc, y) {
    doc.setFillColor(235, 238, 243);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y, CONTENT_W, 8, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(20, 20, 20);
    COLS.forEach((c, i) => {
      const x = colX(i);
      doc.rect(x, y, c.w, 8);
      const tx = c.align === 'center' ? x + c.w / 2 : c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
      const lines = doc.splitTextToSize(c.label, c.w - 2);
      doc.text(lines, tx, y + 3.6, { align: c.align === 'left' ? 'left' : c.align });
    });
    doc.setFont(undefined, 'normal');
    return y + 8;
  }

  function drawItemsTable(doc, data, y) {
    doc.setFontSize(8);
    y = drawTableHeader(doc, y);

    data.totals.computed.forEach((it, idx) => {
      const descLines = doc.splitTextToSize(it.desc || '', COLS[1].w - 3);
      const rowH = Math.max(7, descLines.length * 3.6 + 2);

      if (y + rowH > PAGE_H - MARGIN - 35) {
        doc.addPage();
        y = MARGIN;
        y = drawTableHeader(doc, y);
      }

      const vals = {
        sno: String(idx + 1),
        desc: null,
        hsn: it.hsn || '-',
        qty: `${it.qty} ${it.unit || ''}`.trim(),
        rate: Utils.fmtMoney(it.rate),
        disc: it.disc ? `${it.disc}%` : '-',
        gst: `${it.gst}%`,
        gstAmt: Utils.fmtMoney(it.gstAmt),
        total: Utils.fmtMoney(it.taxable),
      };

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      COLS.forEach((c, i) => {
        const x = colX(i);
        doc.rect(x, y, c.w, rowH);
        if (c.key === 'desc') {
          doc.text(descLines, x + 1.5, y + 4);
        } else {
          const tx = c.align === 'center' ? x + c.w / 2 : c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
          doc.text(vals[c.key], tx, y + rowH / 2 + 1.2, { align: c.align === 'left' ? 'left' : c.align });
        }
      });
      y += rowH;
    });

    return y;
  }


  function estimateBottomHeight(data) {
    const t = data.totals;
    let rows = 2; // taxable + grand total
    if (data.meta.gstType === 'IGST') rows += 1;
    else rows += 2;
    if (t.chargesTotal) rows += 1;
    if (data.overallDiscount) rows += 1;
    if (t.roundOff) rows += 1;
    const totalsH = rows * 6.5 + 2;
    const wordsH = 14;
    let termsH = 8;
    if (data.terms && data.terms.termsText) {
      termsH += data.terms.termsText.length * 5 + 6;
    }
    const sigH = 42;
    return totalsH + wordsH + termsH + sigH + 8;
  }

  // ---- Totals box + Amount in Words (styled like the invoice's bottom section) ----

  function drawTotalsAndWords(doc, data, y) {
    y = ensureSpace(doc, y, 50);
    const t = data.totals;

    const boxW = 75, boxX = PAGE_W - MARGIN - boxW;
    const rowH = 6.5;
    // Derive display GST rate from line items
    const gstRates = (t.computed || []).map((it) => Number(it.gst) || 0).filter((r) => r > 0);
    const mainGst = gstRates.length ? gstRates[0] : 18;
    const halfGst = Utils.round2(mainGst / 2);

    const rows = [['Taxable Amount', Utils.fmtMoney(t.taxable)]];
    if (data.meta.gstType === 'IGST') {
      rows.push(['IGST ' + mainGst + '%', Utils.fmtMoney(t.igst)]);
    } else {
      rows.push(['CGST ' + halfGst + '%', Utils.fmtMoney(t.cgst)]);
      rows.push(['SGST ' + halfGst + '%', Utils.fmtMoney(t.sgst)]);
    }
    if (t.chargesTotal) rows.push(['Add. Charges', Utils.fmtMoney(t.chargesTotal)]);
    if (data.overallDiscount) rows.push(['Discount', '-' + Utils.fmtMoney(data.overallDiscount)]);
    if (t.roundOff) rows.push(['Round Off', Utils.fmtMoney(t.roundOff)]);

    const boxTop = y;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    let ry = y;
    doc.setFontSize(8.5);
    rows.forEach(([label, val]) => {
      doc.rect(boxX, ry, boxW, rowH);
      doc.setFont(undefined, 'normal');
      doc.text(label, boxX + 2, ry + rowH / 2 + 1.2);
      doc.text(String(val), boxX + boxW - 2, ry + rowH / 2 + 1.2, { align: 'right' });
      ry += rowH;
    });

    doc.setFillColor(230, 236, 245);
    doc.rect(boxX, ry, boxW, rowH + 1, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Grand Total', boxX + 2, ry + (rowH + 1) / 2 + 1.3);
    const currencySymbol = data.meta.currency === 'USD' ? '$' : 'Rs.';
    doc.text(`${currencySymbol} ${Utils.fmtMoney(t.finalAmount)}`, boxX + boxW - 2, ry + (rowH + 1) / 2 + 1.3, { align: 'right' });
    doc.setFont(undefined, 'normal');
    ry += rowH + 1;

    // Amount in Words — full width bar BELOW the totals box (lower side)
    const currencyLabel = data.meta.currency === 'USD' ? 'US Dollars' : 'Rupees';
    const wordsText = Utils.amountInWords(t.finalAmount, currencyLabel);
    doc.setFontSize(8.5);
    const wLines = doc.splitTextToSize(wordsText, CONTENT_W - 6);
    const wordsRowH = Math.max(10, wLines.length * 4.2 + 6);

    const wordsTop = ry + 2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.setFillColor(224, 234, 246);
    doc.rect(MARGIN, wordsTop, CONTENT_W, wordsRowH, 'FD');
    doc.setFont(undefined, 'bold');
    doc.text('Amount in Words :-', MARGIN + 2, wordsTop + 4.5);
    doc.setFont(undefined, 'normal');
    doc.text(wLines, MARGIN + 2, wordsTop + 9);

    return wordsTop + wordsRowH + 4;
  }

  function drawTermsAndSignature(doc, data, y) {
    y = ensureSpace(doc, y, 45);
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.setFont(undefined, 'bold');

    if (data.terms.remarks) {
      doc.text('Remarks:', MARGIN, y);
      doc.setFont(undefined, 'normal');
      const lines = doc.splitTextToSize(data.terms.remarks, CONTENT_W);
      doc.text(lines, MARGIN, y + 4);
      y += 4 + lines.length * 4;
      doc.setFont(undefined, 'bold');
    }

    if (data.terms.deliveryTime || data.terms.paymentTerms) {
      y += 2;
      doc.setFontSize(8.5);
      if (data.terms.deliveryTime) { doc.text(`Delivery Time: ${data.terms.deliveryTime}`, MARGIN, y); y += 4.2; }
      doc.setFont(undefined, 'normal');
      if (data.terms.paymentTerms) { doc.text(`Payment Terms: ${data.terms.paymentTerms}`, MARGIN, y); y += 4.2; }
    }

    if (data.terms.termsText && data.terms.termsText.length) {
      y += 3;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(9);
      doc.text('Terms & Conditions:', MARGIN, y);
      y += 4.5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8.5);
      data.terms.termsText.forEach((line, i) => {
        y = ensureSpace(doc, y, 6);
        const wrapped = doc.splitTextToSize(`${i + 1}. ${line}`, CONTENT_W - 4);
        doc.text(wrapped, MARGIN + 2, y);
        y += wrapped.length * 4.2;
      });
    }

    // Bottom signatory strip, bordered like the invoice's closing block
    y = ensureSpace(doc, y, 40);
    y += 4;
    const sigBoxTop = y;
    const sigBoxH = 36;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text(`FOR ${(data.company.name || 'COMPANY').toUpperCase()}`, PAGE_W - MARGIN - 3, sigBoxTop + 6, { align: 'right' });

    const stampW = 22;
    const stampH = 22 * 1111 / 1416;
    if (typeof SIGNATURE_DATA_URI !== 'undefined' && SIGNATURE_DATA_URI) {
      try {
        doc.addImage(SIGNATURE_DATA_URI, 'JPEG', PAGE_W - MARGIN - 3 - stampW, sigBoxTop + 9, stampW, stampH);
      } catch (e) {
        // if the stamp fails to embed for any reason, keep going without it
      }
    }

    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    doc.text('Authorised Signatory', PAGE_W - MARGIN - 3, sigBoxTop + sigBoxH - 3, { align: 'right' });

    return sigBoxTop + sigBoxH;
  }

  return { generate };
})();
