/* docx-export.js — builds an editable Word quotation using the vendored docx.js UMD bundle.
   Layout mirrors the company's existing invoice format: one continuous bordered
   header table (title / company / GSTIN+Mobile / Quotation No.+Date / To / Ref+Validity),
   then the item table, then a totals block + Amount in Words + signatory. */

const DocxExport = (function () {

  function generate(data) {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      WidthType, BorderStyle, AlignmentType, VerticalAlign, ShadingType, ImageRun,
    } = window.docx;

    const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const borders = { top: thin, bottom: thin, left: thin, right: thin };
    const noBorder = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

    const TOTAL_W = 10500; // ~7.29in content width, matches A4 with our margins

    function cell(children, { width, colSpan = 1, shade = null, valign = VerticalAlign.CENTER, bdr = borders, margins } = {}) {
      return new TableCell({
        width: { size: width, type: WidthType.DXA },
        columnSpan: colSpan,
        verticalAlign: valign,
        shading: shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
        margins: margins || { top: 60, bottom: 60, left: 90, right: 90 },
        borders: bdr,
        children,
      });
    }

    function p(text, { bold = false, size = 18, align = AlignmentType.LEFT, color = null, italics = false } = {}) {
      return new Paragraph({ alignment: align, children: [new TextRun({ text: String(text), bold, size, color: color || undefined, italics })] });
    }

    // ---------- Header box (single table, rows share borders = one continuous box) ----------

    const headerRows = [];

    headerRows.push(new TableRow({
      children: [cell([p('QUOTATION', { bold: true, size: 26, align: AlignmentType.CENTER })], { width: TOTAL_W, shade: 'F5F7FA' })],
    }));

    const logoCellChildren = [];
    if (typeof LOGO_DATA_URI !== 'undefined' && LOGO_DATA_URI) {
      try {
        logoCellChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: 'jpg', data: LOGO_DATA_URI, transformation: { width: 55, height: 55 } })],
        }));
      } catch (e) {
        // if the image fails to embed for any reason, keep going without it
      }
    }

    const logoCellBorders = { top: thin, bottom: thin, left: thin, right: { style: BorderStyle.NONE } };
    const brandTextBorders = { top: thin, bottom: thin, left: { style: BorderStyle.NONE }, right: thin };

    headerRows.push(new TableRow({
      children: logoCellChildren.length
        ? [
            cell(logoCellChildren, { width: 1600, bdr: logoCellBorders }),
            cell([
              p(data.company.name || 'Company Name', { bold: true, size: 30, align: AlignmentType.CENTER, color: '1A3D9C' }),
              p(data.company.address || '', { size: 17, align: AlignmentType.CENTER }),
            ], { width: TOTAL_W - 1600, bdr: brandTextBorders }),
          ]
        : [cell([
            p(data.company.name || 'Company Name', { bold: true, size: 30, align: AlignmentType.CENTER, color: '1A3D9C' }),
            p(data.company.address || '', { size: 17, align: AlignmentType.CENTER }),
          ], { width: TOTAL_W })],
    }));

    headerRows.push(new TableRow({
      children: [
        cell([p(`GSTIN Number :- ${data.company.gstin || ''}`, { bold: true, size: 18 })], { width: TOTAL_W / 2 }),
        cell([p(`Mobile Number :- ${data.company.phone || ''}`, { bold: true, size: 18, align: AlignmentType.RIGHT })], { width: TOTAL_W / 2 }),
      ],
    }));

    headerRows.push(new TableRow({
      children: [
        cell([p(`Quotation No.: ${data.meta.quoteNo || ''}`, { bold: true, size: 18 })], { width: TOTAL_W / 2 }),
        cell([p(`Date :- ${Utils.formatDateDMY(data.meta.date)}`, { bold: true, size: 18, align: AlignmentType.RIGHT })], { width: TOTAL_W / 2 }),
      ],
    }));

    const billParas = [p('To,', { bold: true, size: 18 })];
    if (data.customer.name) billParas.push(p(data.customer.name, { bold: true, size: 18 }));
    if (data.customer.address) billParas.push(p(data.customer.address, { size: 18 }));
    if (data.customer.gstin) billParas.push(p(`GSTIN :- ${data.customer.gstin}`, { size: 18 }));
    if (data.customer.contact) billParas.push(p(`Kind Attn.: ${data.customer.contact}`, { size: 18 }));
    if (data.meta.subject) billParas.push(p(`Subject: ${data.meta.subject}`, { size: 18, bold: true }));

    headerRows.push(new TableRow({ children: [cell(billParas, { width: TOTAL_W })] }));

    headerRows.push(new TableRow({
      children: [cell([p(`Valid Until :- ${Utils.formatDateDMY(data.meta.validUntil)}`, { bold: true, size: 18 })], { width: TOTAL_W })],
    }));

    const headerTable = new Table({ width: { size: TOTAL_W, type: WidthType.DXA }, rows: headerRows });

    // ---------- Item table ----------

    const COLW = { sno: 500, desc: 3100, hsn: 900, qty: 700, rate: 1100, disc: 700, gst: 700, gstamt: 1100, total: 1200 };

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        cell([p('Sr.No.', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.sno, shade: 'EBEEF3' }),
        cell([p('Material / Service Description', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.desc, shade: 'EBEEF3' }),
        cell([p('HSN/SAC', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.hsn, shade: 'EBEEF3' }),
        cell([p('Qty.', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.qty, shade: 'EBEEF3' }),
        cell([p('Unit Rate', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.rate, shade: 'EBEEF3' }),
        cell([p('Disc.%', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.disc, shade: 'EBEEF3' }),
        cell([p('GST%', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.gst, shade: 'EBEEF3' }),
        cell([p('GST Amt', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.gstamt, shade: 'EBEEF3' }),
        cell([p('Amount', { bold: true, size: 16, align: AlignmentType.CENTER })], { width: COLW.total, shade: 'EBEEF3' }),
      ],
    });

    const itemRows = data.totals.computed.map((it, idx) => new TableRow({
      children: [
        cell([p(idx + 1, { size: 16, align: AlignmentType.CENTER })], { width: COLW.sno }),
        cell([p(it.desc || '', { size: 16 })], { width: COLW.desc }),
        cell([p(it.hsn || '-', { size: 16, align: AlignmentType.CENTER })], { width: COLW.hsn }),
        cell([p(`${it.qty} ${it.unit || ''}`.trim(), { size: 16, align: AlignmentType.CENTER })], { width: COLW.qty }),
        cell([p(Utils.fmtMoney(it.rate), { size: 16, align: AlignmentType.RIGHT })], { width: COLW.rate }),
        cell([p(it.disc ? `${it.disc}%` : '-', { size: 16, align: AlignmentType.CENTER })], { width: COLW.disc }),
        cell([p(`${it.gst}%`, { size: 16, align: AlignmentType.CENTER })], { width: COLW.gst }),
        cell([p(Utils.fmtMoney(it.gstAmt), { size: 16, align: AlignmentType.RIGHT })], { width: COLW.gstamt }),
        cell([p(Utils.fmtMoney(it.taxable), { size: 16, align: AlignmentType.RIGHT })], { width: COLW.total }),
      ],
    }));

    const itemsTable = new Table({ width: { size: TOTAL_W, type: WidthType.DXA }, rows: [headerRow, ...itemRows] });

    // ---------- Totals block + Amount in Words (two-column: words left, figures right) ----------

    const t = data.totals;
    const totalsLines = [[`Taxable Amount`, Utils.fmtMoney(t.taxable)]];
    if (data.meta.gstType === 'IGST') {
      totalsLines.push(['IGST', Utils.fmtMoney(t.igst)]);
    } else {
      totalsLines.push(['CGST', Utils.fmtMoney(t.cgst)]);
      totalsLines.push(['SGST', Utils.fmtMoney(t.sgst)]);
    }
    if (t.chargesTotal) totalsLines.push(['Add. Charges', Utils.fmtMoney(t.chargesTotal)]);
    if (data.overallDiscount) totalsLines.push(['Discount', '-' + Utils.fmtMoney(data.overallDiscount)]);
    if (t.roundOff) totalsLines.push(['Round Off', Utils.fmtMoney(t.roundOff)]);

    const currencySymbol = data.meta.currency === 'USD' ? '$' : 'Rs.';
    const currencyLabel = data.meta.currency === 'USD' ? 'US Dollars' : 'Rupees';
    const wordsText = Utils.amountInWords(t.finalAmount, currencyLabel);

    // Merge the words cell down across all totals rows using rowSpan on the first row
    const totalsTableRows = totalsLines.map(([label, val], i) => new TableRow({
      children: i === 0
        ? [
          new TableCell({
            width: { size: TOTAL_W * 0.5, type: WidthType.DXA },
            rowSpan: totalsLines.length + 1,
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E0EAF6' },
            margins: { top: 60, bottom: 60, left: 90, right: 90 },
            borders,
            children: [p('Amount in Words :-', { bold: true, size: 16 }), p(wordsText, { size: 16 })],
          }),
          cell([p(label, { size: 16 })], { width: TOTAL_W * 0.28 }),
          cell([p(String(val), { size: 16, align: AlignmentType.RIGHT })], { width: TOTAL_W * 0.22 }),
        ]
        : [
          cell([p(label, { size: 16 })], { width: TOTAL_W * 0.28 }),
          cell([p(String(val), { size: 16, align: AlignmentType.RIGHT })], { width: TOTAL_W * 0.22 }),
        ],
    }));

    totalsTableRows.push(new TableRow({
      children: [
        cell([p('Grand Total', { bold: true, size: 20 })], { width: TOTAL_W * 0.28, shade: 'E6ECF5' }),
        cell([p(`${currencySymbol} ${Utils.fmtMoney(t.finalAmount)}`, { bold: true, size: 20, align: AlignmentType.RIGHT })], { width: TOTAL_W * 0.22, shade: 'E6ECF5' }),
      ],
    }));

    const totalsTable = new Table({ width: { size: TOTAL_W, type: WidthType.DXA }, rows: totalsTableRows });

    // ---------- Assemble document ----------

    const children = [headerTable, itemsTable, totalsTable, p('', { size: 4 })];

    if (data.terms.remarks) {
      children.push(p('Remarks:', { bold: true, size: 18 }));
      children.push(p(data.terms.remarks, { size: 16 }));
    }
    if (data.terms.deliveryTime) children.push(p(`Delivery Time: ${data.terms.deliveryTime}`, { size: 16 }));
    if (data.terms.paymentTerms) children.push(p(`Payment Terms: ${data.terms.paymentTerms}`, { size: 16 }));

    if (data.terms.termsText.length) {
      children.push(p('', { size: 4 }));
      children.push(p('Terms & Conditions:', { bold: true, size: 18 }));
      data.terms.termsText.forEach((line, i) => children.push(p(`${i + 1}. ${line}`, { size: 16 })));
    }

    children.push(p('', { size: 4 }));

    const signatureTable = new Table({
      width: { size: TOTAL_W, type: WidthType.DXA },
      rows: [new TableRow({
        children: [new TableCell({
          width: { size: TOTAL_W, type: WidthType.DXA },
          borders,
          margins: { top: 200, bottom: 200, left: 120, right: 120 },
          children: [
            p(`FOR ${(data.company.name || 'COMPANY').toUpperCase()}`, { bold: true, size: 18, align: AlignmentType.RIGHT }),
            p('', { size: 4 }),
            p('', { size: 4 }),
            p('Authorised Signatory', { size: 16, align: AlignmentType.RIGHT }),
          ],
        })],
      })],
    });
    children.push(signatureTable);

    const doc = new Document({
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 700, bottom: 700, left: 900, right: 900 } } },
        children,
      }],
    });

    Packer.toBlob(doc).then((blob) => {
      const filename = `Quotation_${(data.meta.quoteNo || 'draft').replace(/[^\w-]/g, '_')}.docx`;
      return FileSaver.saveOrShare(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').then((res) => {
        if (res.method === 'failed') {
          QGenApp.toast('Word export failed — try again or check storage permission');
        } else if (res.method === 'cancelled') {
          // no message needed
        } else {
          QGenApp.toast(res.method === 'share' ? 'Word file ready to save/share' : 'Word file downloaded');
        }
      });
    }).catch((err) => {
      console.error('DOCX generation failed', err);
      QGenApp.toast('Word export failed — check console for details');
    });
  }

  return { generate };
})();
