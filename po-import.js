/* po-import.js — Upload PO (PDF/image) → extract PO No, Date, line items (not Bill To) */

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
    // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
    let m = s.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
    if (m) {
      let d = m[1].padStart(2, '0');
      let mo = m[2].padStart(2, '0');
      let y = m[3];
      if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
      return y + '-' + mo + '-' + d;
    }
    // YYYY-MM-DD
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
      subject: '',
      items: [],
      rawSnippet: t.slice(0, 500),
    };

    // PO Number
    const poPatterns = [
      /PO\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /P\.?O\.?\s*(?:Number|No\.?)\s*[:.]?\s*([0-9]{6,})/i,
      /Purchase\s*Order\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /\b(45\d{8,})\b/, // common SAP-style PO
    ];
    for (const re of poPatterns) {
      const m = t.match(re);
      if (m) {
        result.poNumber = m[1];
        break;
      }
    }

    // Date near PO
    const datePatterns = [
      /(?:PO\s*)?Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i,
      /Dated\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i,
      /\b(\d{2}[./\-]\d{2}[./\-]\d{4})\b/,
    ];
    for (const re of datePatterns) {
      const m = t.match(re);
      if (m) {
        const iso = parseDateToISO(m[1]);
        if (iso) {
          result.poDate = iso;
          break;
        }
      }
    }

    // Subject / first material description line
    const subM = t.match(/SUB(?:JECT)?\s*[:.]?\s*([^\n]{5,80})/i);
    if (subM) result.subject = subM[1].trim();

    // HSN codes
    const hsnList = [];
    const hsnRe = /HSN\s*\/?\s*SAC\s*(?:Code)?\s*[:.]?\s*(\d{4,8})/gi;
    let hm;
    while ((hm = hsnRe.exec(t)) !== null) hsnList.push(hm[1]);

    // Line items: description + qty + rate
    // Strategy: find blocks with a rate-like number (thousands with commas or decimals)
    // and a qty nearby
    const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // skip headers / address noise
      if (/^(SL|Sr\.?|Registered|SUPPLIER|Bill\s*to|Ship\s*to|ATTENTION|Page\s*\d)/i.test(line)) continue;
      if (/TOTAL|Grand\s*Total|Terms\s*of\s*PAYMENT|OTHER\s*TERMS/i.test(line)) continue;

      // Pattern: description ... qty ... rate
      // e.g. "Mobile Tablet for Barcode scanner 2.000 AU 19,750.00 39,500.00"
      const row = line.match(
        /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:AU|NOS|NO|EA|EACH|SET|MTR|KG|PCS|PC|QTY)?\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})?$/i
      );
      if (row) {
        const desc = row[1].replace(/\s+/g, ' ').trim();
        if (desc.length < 3 || /RATE|PRICE|DESCRIPTION|QTY/i.test(desc)) continue;
        const qty = parseMoney(row[2]);
        const rate = parseMoney(row[3]);
        if (rate <= 0 || qty <= 0) continue;
        if (rate < 1 && qty > 100) continue;
        items.push({
          desc,
          qty,
          rate,
          unit: 'Each',
          hsn: hsnList[items.length] || '',
          disc: 0,
          gst: 18,
        });
        continue;
      }

      // Two-line: desc on one line, numbers on next
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nums = next.match(
          /^(\d+(?:[.,]\d+)?)\s*(?:AU|NOS|NO|EA|EACH|SET|MTR|KG|PCS)?\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{2})/i
        );
        if (nums && line.length > 5 && line.length < 120 && !/\d{5,}/.test(line)) {
          const desc = line.replace(/\s+/g, ' ').trim();
          if (/RATE|PRICE|DESCRIPTION|Registered|LAPP|SUPPLIER|Kanak/i.test(desc)) continue;
          const qty = parseMoney(nums[1]);
          const rate = parseMoney(nums[2]);
          if (qty > 0 && rate > 0) {
            items.push({
              desc,
              qty,
              rate,
              unit: 'Each',
              hsn: hsnList[items.length] || '',
              disc: 0,
              gst: 18,
            });
            i += 1;
          }
        }
      }
    }

    // Fallback: look for "DESCRIPTION" table region and rates
    if (!items.length) {
      const rateHits = [...t.matchAll(/(\d{1,3}(?:,\d{3})+\.\d{2}|\d{4,}\.\d{2})/g)].map((m) => ({
        val: parseMoney(m[1]),
        idx: m.index,
      }));
      // Often unit rate appears before line total (rate < total)
      for (let i = 0; i < rateHits.length - 1; i++) {
        const rate = rateHits[i].val;
        const total = rateHits[i + 1].val;
        if (rate >= 10 && total >= rate && total <= rate * 1000) {
          const qtyGuess = Math.round((total / rate) * 1000) / 1000;
          if (qtyGuess > 0 && qtyGuess < 100000) {
            // description: text before rate
            const slice = t.slice(Math.max(0, rateHits[i].idx - 80), rateHits[i].idx);
            const descM = slice.match(/([A-Za-z][A-Za-z0-9 ,\-\/()]{6,60})\s*$/);
            const desc = descM ? descM[1].trim() : 'Item from PO';
            if (!/Central\s*GST|State\s*GST|TOTAL|Freight/i.test(desc)) {
              items.push({
                desc,
                qty: qtyGuess,
                rate,
                unit: 'Each',
                hsn: hsnList[items.length] || '',
                disc: 0,
                gst: 18,
              });
              i += 1; // skip total
            }
          }
        }
      }
    }

    // Deduplicate similar
    const seen = new Set();
    result.items = items.filter((it) => {
      const key = (it.desc + '|' + it.rate + '|' + it.qty).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      // filter GST lines mistaken as items
      if (/central\s*gst|state\s*gst|igst|cgst|sgst/i.test(it.desc)) return false;
      if (it.rate > 0 && it.rate < 50 && /gst/i.test(it.desc)) return false;
      return true;
    }).slice(0, 30);

    if (!result.subject && result.items[0]) {
      result.subject = result.items[0].desc.slice(0, 60);
    }

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
    const maxPages = Math.min(pdf.numPages, 5);
    let text = '';
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(' ');
      text += pageText + '\n';
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
    const result = await Tesseract.recognize(file, 'eng', {
      logger: () => {},
    });
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
      throw new Error('PO se text nahi mila — clear PDF / photo try karo');
    }
    return parsePoText(text);
  }

  return { importFile, parsePoText };
})();
