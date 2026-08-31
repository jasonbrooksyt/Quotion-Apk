/* pdf-export.js — builds a print-ready A4 quotation PDF using jsPDF (vendored, offline).
   Layout mirrors the company's existing invoice format: one continuous bordered
   header box (title / company / GSTIN+Mobile / Quotation No.+Date / To / Ref+Validity),
   then a bordered item table, then a totals box + Amount in Words bar + signatory. */

const PdfExport = (function () {

  const PAGE_W = 210, PAGE_H = 297; // mm
  const MARGIN = 12;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const MIDX = MARGIN + CONTENT_W / 2;


  async function buildPdfDoc(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const isInvoice = (data.meta && data.meta.docType === 'invoice') || (data.meta && /^GST\//i.test(String(data.meta.quoteNo || '')));

    let y = MARGIN;
    y = drawHeaderBox(doc, data, y);
    const bodyTop = y;
    const invoiceBottomReserve = 88;
    y = drawItemsTable(doc, data, y, isInvoice ? invoiceBottomReserve : 55);

    let bankTopY = null;
    if (isInvoice) {
      bankTopY = y;
      y = await drawInvoiceBottom(doc, data, y);
    } else {
      const bottomH = estimateBottomHeight(data);
      const minY = PAGE_H - MARGIN - bottomH;
      if (y < minY) y = minY;
      y = drawTotalsAndWords(doc, data, y);
      y = drawTermsAndSignature(doc, data, y);
    }

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    if (isInvoice && bankTopY != null) {
      doc.rect(MARGIN, bodyTop, CONTENT_W, Math.max(0, bankTopY - bodyTop));
    } else {
      doc.rect(MARGIN, bodyTop, CONTENT_W, y - bodyTop);
    }
    return { doc, isInvoice };
  }

  async function generate(data) {
    const { doc, isInvoice } = await buildPdfDoc(data);
    const prefix = isInvoice ? 'Invoice' : 'Quotation';
    const filename = prefix + '_' + (data.meta.quoteNo || 'draft').replace(/[^\w\/-]/g, '_') + '.pdf';
    const blob = doc.output('blob');
    FileSaver.saveOrShare(blob, filename, 'application/pdf').then((res) => {
      if (res.method === 'failed') {
        QGenApp.toast('PDF export failed — try again or check storage permission');
      } else if (res.method === 'cancelled') {
        // user closed share sheet
      } else {
        QGenApp.toast(res.method === 'share' ? 'PDF ready to save/share' : 'PDF downloaded');
      }
    });
  }

  async function preview(data) {
    const { doc } = await buildPdfDoc(data);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const modal = document.getElementById('previewModal');
    const frame = document.getElementById('previewFrame');
    try {
      if (modal && frame) {
        frame.src = url;
        modal.classList.remove('hidden');
        // Mobile browsers sometimes blank iframe for blob — fallback after short check
        setTimeout(() => {
          try {
            const doc2 = frame.contentDocument;
            if (!doc2 || doc2.body === null) {
              window.open(url, '_blank');
            }
          } catch (e) { /* cross-origin ok means pdf loaded */ }
        }, 800);
        return;
      }
    } catch (e) {
      console.warn('preview modal failed', e);
    }
    window.open(url, '_blank');
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
    const titleTxt = (data.meta && data.meta.docType === 'invoice') ? 'Tax Invoice' : 'QUOTATION';
    doc.text(titleTxt, PAGE_W / 2, y + rTitleH / 2 + 1.6, { align: 'center' });
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
    doc.setFontSize((data.meta && data.meta.docType === 'invoice') ? 15 : 14);
    doc.setTextColor(26, 61, 156);
    doc.text(data.company.name || 'Company Name', PAGE_W / 2, y + 9, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(40, 40, 40);
    if (data.meta && data.meta.docType === 'invoice') {
      const office = 'Office :' + (data.company.address || '');
      const emailLine = 'Email :- ' + (data.company.email || '');
      doc.text(office, PAGE_W / 2, y + 13.5, { align: 'center', maxWidth: CONTENT_W - 46 });
      doc.text(emailLine, PAGE_W / 2, y + 17.5, { align: 'center' });
    } else {
      doc.setFontSize(8.5);
      doc.text(data.company.address || '', PAGE_W / 2, y + 15, { align: 'center', maxWidth: CONTENT_W - 46 });
    }
    y += rBrandH;
    hLine(doc, y);

    // Row: GSTIN Number / Mobile Number
    const mob = (data.meta && data.meta.docType === 'invoice' && data.company.phone && !String(data.company.phone).startsWith('+'))
      ? ('+91-' + data.company.phone) : (data.company.phone || '');
    y = twoColRowLeftLabel(doc, y, 7, 'GSTIN Number :- ' + (data.company.gstin || ''), 'Mobile Number :- ' + mob, { bold: true, size: 9 });
    hLine(doc, y);

    // Row: Quotation No. / Date
    const noLabel = (data.meta && data.meta.docType === 'invoice') ? 'INVOICE No.:' : 'Quotation No.:';
    y = twoColRowLeftLabel(doc, y, 7, noLabel + ' ' + (data.meta.quoteNo || ''), 'Date :- ' + Utils.formatDateDMY(data.meta.date), { bold: true, size: 9 });
    hLine(doc, y);

    // Row: Bill To block (multi-line, left aligned, full width)
    const billLines = [];
    billLines.push({ text: (data.meta && data.meta.docType === 'invoice') ? 'Bill To' : 'To,', bold: true });
    if (data.customer.name) billLines.push({ text: data.customer.name, bold: true });
    if (data.customer.address) {
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(data.customer.address, CONTENT_W * 0.55);
      wrapped.forEach((l) => billLines.push({ text: l, bold: false }));
    }
    if (data.customer.gstin) billLines.push({ text: `GSTIN :- ${data.customer.gstin}`, bold: false });
    if (data.customer.contact) billLines.push({ text: `Kind Attn.: ${data.customer.contact}`, bold: false });

    // Subject with a small visual gap after address block
    const subjectLines = [];
    if (data.meta.subject) {
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(`Subject: ${data.meta.subject}`, CONTENT_W - 4);
      wrapped.forEach((l, i) => subjectLines.push({ text: l, bold: i === 0 }));
    }

    const gapBeforeSubject = subjectLines.length ? 3.5 : 0;
    const rBillH = Math.max(9, billLines.length * 4.3 + gapBeforeSubject + subjectLines.length * 4.3 + 3);
    let ly = y + 4;
    billLines.forEach((l) => {
      doc.setFont(undefined, l.bold ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.text(l.text, MARGIN + 2, ly);
      ly += 4.3;
    });
    if (subjectLines.length) {
      ly += gapBeforeSubject;
      subjectLines.forEach((l) => {
        doc.setFont(undefined, l.bold ? 'bold' : 'normal');
        doc.setFontSize(9);
        doc.text(l.text, MARGIN + 2, ly);
        ly += 4.3;
      });
    }
    doc.setFont(undefined, 'normal');
    y += rBillH;
    hLine(doc, y);

    // PO row for invoice
    if (data.meta && data.meta.docType === 'invoice' && (data.meta.poNumber || data.meta.poDate)) {
      const poH = 7;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(9);
      const left = 'Purchase Order Number :- ' + (data.meta.poNumber || '-');
      const right = 'Date :- ' + (data.meta.poDate ? Utils.formatDateDMY(data.meta.poDate) : '-');
      doc.text(left, MARGIN + 2, y + poH / 2 + 1.3);
      doc.text(right, MARGIN + CONTENT_W - 2, y + poH / 2 + 1.3, { align: 'right' });
      doc.setFont(undefined, 'normal');
      y += poH;
      hLine(doc, y);
    }

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

  function getCols(isInvoice) {
    if (isInvoice) {
      // Match reference Tax Invoice columns (no GST columns in body table)
      return [
        { key: 'sno', label: 'Sr.No.', w: 11, align: 'center' },
        { key: 'desc', label: 'Material/ Service Descriptions', w: 78, align: 'left' },
        { key: 'hsn', label: 'HSN/SAC\nCODE', w: 18, align: 'center' },
        { key: 'qty', label: 'Qty.', w: 16, align: 'center' },
        { key: 'rate', label: 'Unit Rate', w: 21, align: 'center' },
        { key: 'disc', label: 'Disc. %', w: 14, align: 'center' },
        { key: 'total', label: 'Amount\n(in Rupees)', w: 28, align: 'right' },
      ];
    }
    return [
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
  }

  function colX(cols, idx) {
    let x = MARGIN;
    for (let i = 0; i < idx; i++) x += cols[i].w;
    return x;
  }

  function drawTableHeader(doc, y, cols, opts) {
    opts = opts || {};
    const centerHeaderKeys = opts.centerHeaderKeys || null; // Set of keys to force center in header only
    const headH = 10;
    doc.setFillColor(235, 238, 243);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y, CONTENT_W, headH, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(20, 20, 20);
    cols.forEach((c, i) => {
      const x = colX(cols, i);
      doc.rect(x, y, c.w, headH);
      const headAlign = (centerHeaderKeys && centerHeaderKeys.indexOf(c.key) >= 0) ? 'center' : c.align;
      const tx = headAlign === 'center' ? x + c.w / 2 : headAlign === 'right' ? x + c.w - 1.5 : x + 1.5;
      const lines = String(c.label).split('\n');
      const startY = y + (headH - lines.length * 3.2) / 2 + 2.5;
      lines.forEach((ln, li) => {
        doc.text(ln, tx, startY + li * 3.2, { align: headAlign === 'left' ? 'left' : headAlign });
      });
    });
    doc.setFont(undefined, 'normal');
    return y + headH;
  }

  function drawItemsTable(doc, data, y, bottomReserve) {
    const isInvoice = (data.meta && data.meta.docType === 'invoice') || /^GST\//i.test(String((data.meta && data.meta.quoteNo) || ''));
    const cols = getCols(isInvoice);
    doc.setFontSize(8);
    const headerOpts = isInvoice
      ? { centerHeaderKeys: ['desc', 'rate', 'total'] }
      : {};
    y = drawTableHeader(doc, y, cols, headerOpts);

    const items = data.totals.computed || [];
    const reserve = bottomReserve != null ? bottomReserve : 55;
    // Compact rows (no per-item stretch). Extra space stays AFTER all items, before bank.

    items.forEach((it, idx) => {
      // Font size FIRST so wrap width matches drawn text (prevent overflow into next col)
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      const descCol = cols.find((c) => c.key === 'desc') || cols[1];
      const descMaxW = Math.max(8, descCol.w - 3.5);
      let descLines = doc.splitTextToSize(String(it.desc || ''), descMaxW);
      // Cap lines so row stays readable; last line ellipsis if clipped
      const maxDescLines = 6;
      if (descLines.length > maxDescLines) {
        descLines = descLines.slice(0, maxDescLines);
        const last = String(descLines[maxDescLines - 1] || '');
        descLines[maxDescLines - 1] = last.length > 3 ? last.slice(0, -3) + '...' : last + '...';
      }
      const rowH = Math.max(9, descLines.length * 3.4 + 4);

      if (y + rowH > PAGE_H - MARGIN - 20 && !isInvoice) {
        doc.addPage();
        y = MARGIN;
        y = drawTableHeader(doc, y, cols, headerOpts);
      }

      const qtyStr = isInvoice
        ? (String(it.qty).padStart(2, '0') + ' ' + (it.unit || 'EA')).trim()
        : (it.qty + ' ' + (it.unit || '')).trim();

      const gross = Utils.round2((Number(it.qty) || 0) * (Number(it.rate) || 0));
      const discAmt = (it.discAmt != null) ? Number(it.discAmt) : Utils.round2(gross * (Number(it.disc) || 0) / 100);
      const vals = {
        sno: String(idx + 1),
        desc: null,
        hsn: it.hsn || '',
        qty: qtyStr,
        rate: Utils.fmtMoney(it.rate),
        disc: (Number(it.disc) ? Utils.round2(Number(it.disc)) + '%' : '0%'),
        gst: it.gst + '%',
        gstAmt: Utils.fmtMoney(it.gstAmt),
        total: Utils.fmtMoney(it.taxable),
      };

      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.25);
      cols.forEach((c, i) => {
        const x = colX(cols, i);
        doc.rect(x, y, c.w, rowH);
        if (c.key === 'desc') {
          // Clip text strictly inside description cell
          doc.saveGraphicsState();
          doc.rect(x + 0.4, y + 0.4, c.w - 0.8, rowH - 0.8, null);
          doc.clip();
          doc.setFont(undefined, 'normal');
          doc.setFontSize(8);
          doc.text(descLines, x + 1.2, y + 4.2);
          doc.restoreGraphicsState();
        } else if (c.key === 'sno') {
          doc.setFont(undefined, 'bold');
          doc.setFontSize(9);
          const tx = x + c.w / 2;
          doc.text(String(vals[c.key] || ''), tx, y + 5, { align: 'center' });
        } else {
          doc.setFont(undefined, c.key === 'total' ? 'bold' : 'normal');
          doc.setFontSize(8);
          const tx = c.align === 'center' ? x + c.w / 2 : c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
          // soft clip other cells too (qty/rate can be long)
          const txt = String(vals[c.key] || '');
          doc.saveGraphicsState();
          doc.rect(x + 0.3, y + 0.3, c.w - 0.6, rowH - 0.6, null);
          doc.clip();
          doc.text(txt, tx, y + 5, { align: c.align === 'left' ? 'left' : c.align });
          doc.restoreGraphicsState();
        }
      });
      y += rowH;
    });

    // Invoice: keep bank/QR block at bottom; empty area under items (not between items)
    if (isInvoice) {
      const bankStart = PAGE_H - MARGIN - reserve;
      if (y < bankStart) y = bankStart;
    }

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


  async function loadQrDataUrl(upiUri) {
    try {
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=' + encodeURIComponent(upiUri);
      const res = await fetch(qrUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('QR load failed', e);
      return null;
    }
  }

  async function drawInvoiceBottom(doc, data, y) {
    y = ensureSpace(doc, y, 85);
    const t = data.totals;
    const bank = data.bank || (typeof BANK !== 'undefined' ? BANK : {});

    const gstRates = (t.computed || []).map((it) => Number(it.gst) || 0).filter((r) => r > 0);
    const mainGst = gstRates.length ? gstRates[0] : 18;
    const halfGst = Utils.round2(mainGst / 2);

    // Align with item columns: Bank = Sr+Desc | QR = HSN+Qty | Totals = Rate+Disc+Amt
    // Col widths: 11+78 | 18+16 | 21+14+28  = 89 | 34 | 63
    const leftW = 89;
    const midW = 34;
    const rightW = CONTENT_W - leftW - midW; // 63
    const boxH = 44;
    const boxTop = y;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);

    // Outer rectangle + verticals matching HSN left & Qty right from table above
    doc.rect(MARGIN, boxTop, CONTENT_W, boxH);
    doc.line(MARGIN + leftW, boxTop, MARGIN + leftW, boxTop + boxH);
    doc.line(MARGIN + leftW + midW, boxTop, MARGIN + leftW + midW, boxTop + boxH);

    // Bank details (left)
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.text('Bank Details', MARGIN + 2.5, boxTop + 6);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8.5);
    let ly = boxTop + 12.5;
    [
      'Bank Name :- ' + (bank.name || ''),
      'Account No. ' + (bank.accountNo || ''),
      'IFSC Code :- ' + (bank.ifsc || ''),
      'UPI :- ' + (bank.upi || ''),
    ].forEach((line) => {
      doc.text(line, MARGIN + 2.5, ly);
      ly += 5.5;
    });

    // QR — fill almost entire HSN+Qty width, minimal side gap
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6.5);
    doc.text('Scan for Pay', MARGIN + leftW + midW / 2, boxTop + 3.8, { align: 'center' });
    const upiUri = Utils.buildUpiUri(t.finalAmount, data.meta.quoteNo);
    const qrData = await loadQrDataUrl(upiUri);
    const qSize = Math.min(midW - 2, boxH - 7); // near-full cell
    const qx = MARGIN + leftW + (midW - qSize) / 2;
    const qy = boxTop + 4.5;
    if (qrData) {
      try {
        doc.addImage(qrData, 'PNG', qx, qy, qSize, qSize);
      } catch (e) {
        doc.setFont(undefined, 'normal');
        doc.setFontSize(7);
        doc.text('QR unavailable', MARGIN + leftW + midW / 2, boxTop + 24, { align: 'center' });
      }
    } else {
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
      doc.text('QR needs internet', MARGIN + leftW + midW / 2, boxTop + 24, { align: 'center' });
    }

    // Totals right — internal lines only (outer frame already drawn; keeps QR top line clean)
    const tx = MARGIN + leftW + midW;
    const rowH = 9;
    const totalRows = [['Taxable Amount', Utils.fmtMoney(t.taxable)]];
    if (data.meta.gstType === 'IGST') {
      totalRows.push(['IGST  ' + mainGst + '%', Utils.fmtMoney(t.igst)]);
    } else {
      totalRows.push(['CGST  ' + halfGst + '%', Utils.fmtMoney(t.cgst)]);
      totalRows.push(['SGST  ' + halfGst + '%', Utils.fmtMoney(t.sgst)]);
    }
    let ry = boxTop;
    totalRows.forEach(([label, val]) => {
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8);
      doc.text(label, tx + 2, ry + rowH / 2 + 1.3);
      doc.setFont(undefined, 'normal');
      doc.text(String(val), tx + rightW - 2, ry + rowH / 2 + 1.3, { align: 'right' });
      ry += rowH;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.25);
      doc.line(tx, ry, tx + rightW, ry);
    });
    const gtH = boxH - (ry - boxTop);
    doc.setFillColor(220, 230, 245);
    doc.rect(tx, ry, rightW, gtH, 'F');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    doc.line(tx, ry, tx + rightW, ry);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Grand Total', tx + 2, ry + gtH / 2 + 1.4);
    doc.text(Utils.fmtMoney(t.finalAmount), tx + rightW - 2, ry + gtH / 2 + 1.4, { align: 'right' });

    y = boxTop + boxH;

    // Amount in Words — reference style: label cell + words cell (full width bar)
    const wordsH = 12;
    const labelW = CONTENT_W * 0.28;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.setFillColor(200, 220, 240);
    doc.rect(MARGIN, y, labelW, wordsH, 'FD');
    doc.setFillColor(210, 228, 245);
    doc.rect(MARGIN + labelW, y, CONTENT_W - labelW, wordsH, 'FD');
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text('Amount in Words :-', MARGIN + labelW / 2, y + 7.2, { align: 'center' });
    const currencyLabel = data.meta.currency === 'USD' ? 'US Dollars' : 'Rupees';
    let wordsText = Utils.amountInWords(t.finalAmount, currencyLabel);
    if (data.meta.currency !== 'USD' && !/^INR/i.test(wordsText)) {
      wordsText = 'INR ' + wordsText;
    }
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10);
    doc.text(wordsText, MARGIN + labelW + 3, y + 7.2);
    y += wordsH;

    // Signature strip
    const sigBoxTop = y;
    const sigBoxH = 30;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.text('FOR ' + (data.company.name || 'COMPANY').toUpperCase(), PAGE_W - MARGIN - 3, sigBoxTop + 6, { align: 'right' });
    const stampW = 22;
    const stampH = 22 * 1111 / 1416;
    if (typeof SIGNATURE_DATA_URI !== 'undefined' && SIGNATURE_DATA_URI) {
      try {
        doc.addImage(SIGNATURE_DATA_URI, 'JPEG', PAGE_W - MARGIN - 3 - stampW, sigBoxTop + 7, stampW, stampH);
      } catch (e) {}
    }
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8.5);
    doc.text('Authorised Signatory', PAGE_W - MARGIN - 3, sigBoxTop + sigBoxH - 3, { align: 'right' });
    return sigBoxTop + sigBoxH;
  }

  return { generate, preview, buildPdfDoc };
})();

