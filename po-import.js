/* po-import.js — Upload PO → PO No, Date, line items only (no subject / Bill To) */

const PoImport = (function () {
  function normalizeText(t) {
    return String(t || '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  function parseDateToISO(raw) {
    if (!raw) return '';
    const s = String(raw).trim().replace(/\s/g, '');
    let m = s.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
    if (m) {
      let d = m[1].padStart(2, '0');
      let mo = m[2].padStart(2, '0');
      let y = m[3];
      if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
      // sanity: year 2000-2099, month 1-12
      if (Number(mo) < 1 || Number(mo) > 12) return '';
      if (Number(y) < 2000 || Number(y) > 2099) return '';
      return y + '-' + mo + '-' + d;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    return '';
  }

  function parseMoney(s) {
    if (!s) return 0;
    const cleaned = String(s).replace(/,/g, '').replace(/[^\d.]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function parsePoText(text) {
    const t = normalizeText(text);
    const result = {
      poNumber: '',
      poDate: '',
      items: [],
      rawSnippet: t.slice(0, 800),
    };

    // --- PO Number ---
    const poPatterns = [
      /PO\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /P\.?O\.?\s*(?:Number|No\.?)\s*[:.]?\s*([0-9]{6,})/i,
      /Purchase\s*Order\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /\b(45\d{8,})\b/,
    ];
    for (const re of poPatterns) {
      const m = t.match(re);
      if (m) {
        result.poNumber = m[1];
        break;
      }
    }

    // --- PO Date (NOT Delivery Date, NOT invoice date) ---
    // Prefer "Date" that appears near PO No block
    let poDateRaw = '';
    if (result.poNumber) {
      const idx = t.indexOf(result.poNumber);
      const window = t.slice(Math.max(0, idx - 40), idx + 120);
      const near = window.match(
        /(?:^|[^a-z])Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i
      );
      if (near) poDateRaw = near[1];
    }
    if (!poDateRaw) {
      // PO No. : xxx  Date : dd.mm.yyyy  (same region)
      const m = t.match(
        /PO\s*No\.?\s*[:.]?\s*[0-9]{6,}[\s\S]{0,80}?Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i
      );
      if (m) poDateRaw = m[1];
    }
    if (!poDateRaw) {
      // Explicit PO Date label
      const m = t.match(/PO\s*Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i);
      if (m) poDateRaw = m[1];
    }
    if (!poDateRaw) {
      // First "Date :" that is NOT Delivery Date
      const all = [...t.matchAll(/\bDate\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi)];
      for (const m of all) {
        const before = t.slice(Math.max(0, m.index - 20), m.index);
        if (/Delivery/i.test(before)) continue;
        poDateRaw = m[1];
        break;
      }
    }
    if (poDateRaw) {
      result.poDate = parseDateToISO(poDateRaw);
    }

    // HSN list
    const hsnList = [];
    const hsnRe = /(?:HSN\s*\/?\s*SAC\s*(?:Code)?\s*[:.]?\s*)?(\d{6,8})/gi;
    let hm;
    while ((hm = hsnRe.exec(t)) !== null) {
      // filter phone-like / PO numbers
      if (hm[1].length >= 6 && hm[1].length <= 8 && !hm[1].startsWith('45')) {
        hsnList.push(hm[1]);
      }
    }

    // --- Line items ---
    // Prefer rows with unit AU / NOS etc. and two money values (rate + amount)
    const items = [];
    const itemRe =
      /([A-Za-z][A-Za-z0-9 ,\-\/\(\)\+]{4,90}?)\s+(\d+(?:\.\d+)?)\s*(AU|NOS|NO|EA|EACH|SET|MTR|KG|PCS|PC|UOM|UNIT)?\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi;

    let im;
    while ((im = itemRe.exec(t)) !== null) {
      let desc = im[1].replace(/\s+/g, ' ').trim();
      // trim leading junk from table headers stuck to desc
      desc = desc.replace(/^(MATERIAL|DESCRIPTION|CODE|SL\s*NO|QTY|RATE|PRICE)\s+/i, '').trim();
      if (desc.length < 4) continue;
      if (/RATE|PRICE|DESCRIPTION|QTY|TOTAL|GST|SUPPLIER|Registered|Bill\s*to|Ship\s*to|ATTENTION|PAGE|LAPP|Kanak|Delivery|Freight|Central|State/i.test(desc)) {
        // allow if desc still has real product words after removing noise
        const cleaned = desc
          .replace(/RATE|PRICE|DESCRIPTION|QTY|TOTAL|GST|Delivery\s*Date/gi, '')
          .trim();
        if (cleaned.length < 4) continue;
        desc = cleaned;
      }
      const qty = parseMoney(im[2]);
      const unitRaw = (im[3] || 'AU').toUpperCase();
      const rate = parseMoney(im[4]);
      const amount = parseMoney(im[5]);
      if (qty <= 0 || rate < 1) continue;
      // rate should roughly match amount/qty
      if (amount > 0 && Math.abs(amount - qty * rate) > Math.max(1, amount * 0.05)) {
        // still accept if rate looks like unit rate
      }
      let unit = 'AU';
      if (/NOS|NO|PCS|PC/i.test(unitRaw)) unit = 'Nos';
      else if (/EACH|EA/i.test(unitRaw)) unit = 'Each';
      else if (/MTR/i.test(unitRaw)) unit = 'Mtr';
      else if (/KG/i.test(unitRaw)) unit = 'Kg';
      else if (/SET/i.test(unitRaw)) unit = 'Set';
      else unit = 'AU';

      items.push({
        desc,
        qty,
        rate,
        unit,
        hsn: '',
        disc: 0,
        gst: 18,
      });
    }

    // Fallback: "desc" line then "qty AU rate amount" on nearby text
    if (!items.length) {
      const loose = [
        ...t.matchAll(
          /(\d+(?:\.\d+)?)\s*AU\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi
        ),
      ];
      for (const m of loose) {
        const qty = parseMoney(m[1]);
        const rate = parseMoney(m[2]);
        if (qty <= 0 || rate < 1) continue;
        const before = t.slice(Math.max(0, m.index - 100), m.index);
        // last alphabetic phrase before qty
        const dm = before.match(/([A-Za-z][A-Za-z0-9 ,\-\/\(\)]{5,80})\s*$/);
        let desc = dm ? dm[1].trim() : 'Item from PO';
        desc = desc.replace(/^(.*?)([A-Z][a-z].*)$/, '$2'); // prefer trailing sentence
        if (/TOTAL|GST|RATE|PRICE|DESCRIPTION|QTY|SUPPLIER|Registered/i.test(desc) && desc.length < 25) {
          desc = 'Item from PO';
        }
        items.push({
          desc: desc.slice(0, 120),
          qty,
          rate,
          unit: 'AU',
          hsn: '',
          disc: 0,
          gst: 18,
        });
      }
    }

    // Attach HSN if count matches
    items.forEach((it, i) => {
      if (hsnList[i]) it.hsn = hsnList[i];
    });

    const seen = new Set();
    result.items = items
      .filter((it) => {
        const key = (it.desc + '|' + it.rate + '|' + it.qty).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        if (/central\s*gst|state\s*gst|igst|cgst|sgst/i.test(it.desc)) return false;
        return true;
      })
      .slice(0, 30);

    return result;
  }

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('pdf.js load failed — internet check karo'));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  async function extractTextFromPdf(file) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const maxPages = Math.min(pdf.numPages, 3);
    let text = '';
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // join with newline when y changes a lot (better for tables)
      let lastY = null;
      const parts = [];
      content.items.forEach((it) => {
        const y = it.transform ? it.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 5) parts.push('\n');
        else if (parts.length) parts.push(' ');
        parts.push(it.str);
        if (y != null) lastY = y;
      });
      text += parts.join('') + '\n';
    }
    return text;
  }

  async function loadTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('OCR library load failed'));
      document.head.appendChild(s);
    });
    return window.Tesseract;
  }

  async function extractTextFromImage(file) {
    const Tesseract = await loadTesseract();
    const result = await Tesseract.recognize(file, 'eng', { logger: () => {} });
    return result.data.text || '';
  }

  async function importFile(file) {
    if (!file) throw new Error('No file selected');
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';
    let text = '';
    if (type === 'application/pdf' || name.endsWith('.pdf')) {
      text = await extractTextFromPdf(file);
    } else if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
      text = await extractTextFromImage(file);
    } else {
      throw new Error('Sirf PDF ya image (JPG/PNG) upload karo');
    }
    if (!text || text.trim().length < 20) {
      throw new Error('PO se text nahi mila — clear PDF try karo');
    }
    return parsePoText(text);
  }

  return { importFile, parsePoText };
})();
