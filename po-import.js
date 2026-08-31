/* po-import.js — Upload PO → PO No, Date, items (desc/qty/rate). No subject / Bill To. */

const PoImport = (function () {
  function normalizeText(t) {
    return String(t || '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\u00a0/g, ' ')
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
      if (Number(mo) < 1 || Number(mo) > 12) return '';
      if (Number(y) < 2000 || Number(y) > 2099) return '';
      return y + '-' + mo + '-' + d;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? s : '';
  }

  function parseMoney(s) {
    if (s == null || s === '') return 0;
    const cleaned = String(s).replace(/,/g, '').replace(/[^\d.]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function isNoiseDesc(desc) {
    if (!desc || desc.length < 3) return true;
    const d = desc.toLowerCase();
    return /^(rate|price|qty|description|material|hsn|sac|code|total|gst|cgst|sgst|igst|freight|delivery|supplier|registered|attention|page|lapp|kanak|bill\s*to|ship\s*to|sl\s*no|sr\.?\s*no)/i.test(d)
      || /central\s*gst|state\s*gst|terms\s*of\s*payment|purchase\s*order|other\s*terms/i.test(d);
  }

  function cleanDesc(desc) {
    return String(desc || '')
      .replace(/\s+/g, ' ')
      .replace(/^(SL\s*NO|Sr\.?\s*No\.?|MATERIAL|DESCRIPTION|CODE)\s*/i, '')
      .replace(/\s*HSN\s*\/?\s*SAC.*$/i, '')
      .trim();
  }

  function parsePoText(text) {
    const t = normalizeText(text);
    // Also a flat single-line version for flexible regex
    const flat = t.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    const result = {
      poNumber: '',
      poDate: '',
      items: [],
      rawSnippet: t.slice(0, 1200),
    };

    // ----- PO Number -----
    const poPatterns = [
      /PO\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /P\.?O\.?\s*(?:Number|No\.?)\s*[:.]?\s*([0-9]{6,})/i,
      /Purchase\s*Order\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /\b(45\d{8,})\b/,
    ];
    for (const re of poPatterns) {
      const m = flat.match(re);
      if (m) {
        result.poNumber = m[1];
        break;
      }
    }

    // ----- PO Date (skip Delivery Date) -----
    let poDateRaw = '';
    if (result.poNumber) {
      const idx = flat.indexOf(result.poNumber);
      const window = flat.slice(Math.max(0, idx - 30), idx + 100);
      const near = window.match(/Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i);
      if (near) poDateRaw = near[1];
    }
    if (!poDateRaw) {
      const m = flat.match(
        /PO\s*No\.?\s*[:.]?\s*[0-9]{6,}[\s\S]{0,60}?Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i
      );
      if (m) poDateRaw = m[1];
    }
    if (!poDateRaw) {
      const all = [...flat.matchAll(/\bDate\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi)];
      for (const m of all) {
        const before = flat.slice(Math.max(0, m.index - 25), m.index);
        if (/Delivery/i.test(before)) continue;
        poDateRaw = m[1];
        break;
      }
    }
    if (poDateRaw) result.poDate = parseDateToISO(poDateRaw);

    // ----- HSN codes (6-8 digit, not PO-like) -----
    const hsnList = [];
    for (const m of flat.matchAll(/\b(\d{6,8})\b/g)) {
      const n = m[1];
      if (n.startsWith('45')) continue; // PO nos
      if (n.length >= 6 && n.length <= 8) hsnList.push(n);
    }

    const items = [];
    const unitAlt = 'AU|NOS|NO|EA|EACH|SET|MTR|KG|PCS|PC|UOM|UNITS?|QTY';

    // Strategy A: desc + qty + UNIT + rate + amount  (LAPP style)
    // e.g. Mobile Tablet for Barcode scanner 2.000 AU 19,750.00 39,500.00
    const reA = new RegExp(
      '([A-Za-z][A-Za-z0-9 ,\\-\\/()\\+]{3,100}?)\\s+' +
        '(\\d+(?:\\.\\d+)?)\\s*' +
        '(?:' + unitAlt + ')\\s+' +
        '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
        '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})',
      'gi'
    );
    let m;
    while ((m = reA.exec(flat)) !== null) {
      const desc = cleanDesc(m[1]);
      if (isNoiseDesc(desc)) continue;
      const qty = parseMoney(m[2]);
      const rate = parseMoney(m[3]);
      if (qty > 0 && rate >= 1) {
        items.push({ desc, qty, rate, unit: 'AU', hsn: '', disc: 0, gst: 18 });
      }
    }

    // Strategy B: qty AU rate amount — description is text immediately before
    if (!items.length) {
      const reB = new RegExp(
        '(\\d+(?:\\.\\d+)?)\\s*(' + unitAlt + ')\\s+' +
          '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
          '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})',
        'gi'
      );
      while ((m = reB.exec(flat)) !== null) {
        const qty = parseMoney(m[1]);
        const unitRaw = (m[2] || 'AU').toUpperCase();
        const rate = parseMoney(m[3]);
        if (qty <= 0 || rate < 1) continue;
        const before = flat.slice(Math.max(0, m.index - 120), m.index);
        // Take last "product-like" phrase
        const dm = before.match(
          /([A-Za-z][A-Za-z0-9 ,\-\/()]{4,90}?)\s*$/
        );
        let desc = dm ? cleanDesc(dm[1]) : '';
        // Strip trailing table headers stuck on
        desc = desc.replace(/.*(DESCRIPTION|MATERIAL|CODE)\s+/i, '').trim();
        if (isNoiseDesc(desc)) desc = 'Item from PO';
        let unit = 'AU';
        if (/NOS|NO|PCS|PC/i.test(unitRaw)) unit = 'Nos';
        else if (/EACH|EA/i.test(unitRaw)) unit = 'Each';
        else if (/MTR/i.test(unitRaw)) unit = 'Mtr';
        else if (/KG/i.test(unitRaw)) unit = 'Kg';
        else if (/SET/i.test(unitRaw)) unit = 'Set';
        items.push({ desc: desc.slice(0, 150), qty, rate, unit, hsn: '', disc: 0, gst: 18 });
      }
    }

    // Strategy C: line-by-line — line with only numbers after a text line
    if (!items.length) {
      const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // "2.000 AU 19,750.00 39,500.00"
        const numLine = line.match(
          new RegExp(
            '^(\\d+(?:\\.\\d+)?)\\s*(' + unitAlt + ')?\\s*' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})$',
            'i'
          )
        );
        if (numLine) {
          const qty = parseMoney(numLine[1]);
          const rate = parseMoney(numLine[3]);
          if (qty <= 0 || rate < 1) continue;
          // look back for description
          let desc = 'Item from PO';
          for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
            const cand = cleanDesc(lines[j]);
            if (!isNoiseDesc(cand) && /[A-Za-z]{3}/.test(cand) && cand.length > 4) {
              desc = cand;
              break;
            }
          }
          items.push({
            desc: desc.slice(0, 150),
            qty,
            rate,
            unit: (numLine[2] && /NOS/i.test(numLine[2])) ? 'Nos' : 'AU',
            hsn: '',
            disc: 0,
            gst: 18,
          });
          continue;
        }
        // same line full
        const full = line.match(
          new RegExp(
            '^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*(' + unitAlt + ')\\s+' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})$',
            'i'
          )
        );
        if (full) {
          const desc = cleanDesc(full[1]);
          const qty = parseMoney(full[2]);
          const rate = parseMoney(full[4]);
          if (!isNoiseDesc(desc) && qty > 0 && rate >= 1) {
            items.push({
              desc,
              qty,
              rate,
              unit: /NOS/i.test(full[3] || '') ? 'Nos' : 'AU',
              hsn: '',
              disc: 0,
              gst: 18,
            });
          }
        }
      }
    }

    // Strategy D: pair of money values where second ≈ first * small qty
    // Look for rate-like and amount-like near a small decimal qty
    if (!items.length) {
      const reD = /(\d+(?:\.\d{1,3})?)\s+(?:AU|NOS|EA|EACH)?\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d{2,}\.\d{2})\s+(\d{1,3}(?:,\d{3})+\.\d{2}|\d{2,}\.\d{2})/gi;
      while ((m = reD.exec(flat)) !== null) {
        const qty = parseMoney(m[1]);
        const rate = parseMoney(m[2]);
        const amt = parseMoney(m[3]);
        if (qty <= 0 || qty > 100000 || rate < 10) continue;
        // amount should be in ballpark of qty*rate
        if (amt > 0 && (amt < rate * 0.5 || amt > rate * qty * 1.2 + 1)) {
          // if qty is 1-ish and amt ~ rate ok; else skip mismatch
          if (Math.abs(amt - rate) > 1 && Math.abs(amt - qty * rate) > amt * 0.15) continue;
        }
        const before = flat.slice(Math.max(0, m.index - 100), m.index);
        const dm = before.match(/([A-Za-z][A-Za-z0-9 ,\-\/()]{5,80})\s*$/);
        let desc = dm ? cleanDesc(dm[1]) : 'Item from PO';
        if (isNoiseDesc(desc)) desc = 'Item from PO';
        items.push({ desc: desc.slice(0, 150), qty, rate, unit: 'AU', hsn: '', disc: 0, gst: 18 });
      }
    }

    // HSN attach
    items.forEach((it, i) => {
      if (hsnList[i]) it.hsn = hsnList[i];
    });

    // Dedup
    const seen = new Set();
    result.items = items.filter((it) => {
      const key = (it.desc + '|' + it.qty + '|' + it.rate).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      if (/central\s*gst|state\s*gst/i.test(it.desc)) return false;
      // skip pure GST % rows (rate 9.00 amount small)
      if (it.rate > 0 && it.rate <= 28 && /gst/i.test(it.desc)) return false;
      return true;
    }).slice(0, 30);

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
    const maxPages = Math.min(pdf.numPages, 4);
    let text = '';
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Group by approximate Y → lines (helps table rows)
      const rows = {};
      content.items.forEach((it) => {
        const x = it.transform ? it.transform[4] : 0;
        const y = it.transform ? Math.round(it.transform[5]) : 0;
        const key = String(y);
        if (!rows[key]) rows[key] = [];
        rows[key].push({ x, str: it.str });
      });
      const ys = Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a); // pdf y goes up
      ys.forEach((y) => {
        const parts = rows[String(y)].sort((a, b) => a.x - b.x).map((c) => c.str);
        text += parts.join(' ') + '\n';
      });
      text += '\n';
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
    const parsed = parsePoText(text);
    // Debug aid in console for tuning
    try {
      console.log('[PO import] text sample:', text.slice(0, 600));
      console.log('[PO import] parsed:', parsed);
    } catch (e) {}
    return parsed;
  }

  return { importFile, parsePoText };
})();
