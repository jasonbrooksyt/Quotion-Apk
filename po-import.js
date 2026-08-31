/* po-import.js — PO upload → PO No, Date, items.
 * 1) Optional Gemini AI (set GEMINI_API_KEY in serial-config.js) for accurate parse
 * 2) Fallback: improved heuristics (unit rate vs line total)
 */

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
    return /^(rate|price|qty|description|material|hsn|sac|code|total|gst|cgst|sgst|igst|freight|delivery|supplier|registered|attention|page|lapp|kanak|bill\s*to|ship\s*to|sl\s*no|sr\.?\s*no|inr|only)/i.test(d)
      || /central\s*gst|state\s*gst|terms\s*of\s*payment|purchase\s*order|other\s*terms|redmi pad|tablet 4 gb/i.test(d) && d.length < 20;
  }

  function cleanDesc(desc) {
    return String(desc || '')
      .replace(/\s+/g, ' ')
      .replace(/^(SL\s*NO|Sr\.?\s*No\.?|MATERIAL|DESCRIPTION|CODE)\s*/i, '')
      .replace(/\s*HSN\s*\/?\s*SAC.*$/i, '')
      .trim();
  }

  /** Prefer unit rate: if qty and two amounts, rate is the one where rate*qty ≈ amount */
  function pickRateAndQty(qty, a, b) {
    qty = Number(qty) || 0;
    a = Number(a) || 0;
    b = Number(b) || 0;
    if (qty <= 0) return { qty: 0, rate: 0 };
    // a = rate, b = line total
    if (a > 0 && b > 0) {
      const errA = Math.abs(a * qty - b);
      const errB = Math.abs(b * qty - a);
      if (errA <= errB && errA <= Math.max(2, b * 0.08)) return { qty, rate: a };
      if (errB < errA && errB <= Math.max(2, a * 0.08)) return { qty, rate: b };
      // typical: rate < line total
      if (a < b) return { qty, rate: a };
      return { qty, rate: b };
    }
    if (a > 0 && b <= 0) {
      // single amount — if looks like total, derive rate
      if (qty > 1 && a / qty >= 1) return { qty, rate: Math.round((a / qty) * 100) / 100 };
      return { qty, rate: a };
    }
    return { qty, rate: 0 };
  }

  function parsePoTextHeuristic(text) {
    const t = normalizeText(text);
    const flat = t.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    const result = { poNumber: '', poDate: '', items: [], rawSnippet: t.slice(0, 1200) };

    const poPatterns = [
      /PO\s*No\.?\s*[:.]?\s*([0-9]{6,})/i,
      /P\.?O\.?\s*(?:Number|No\.?)\s*[:.]?\s*([0-9]{6,})/i,
      /\b(45\d{8,})\b/,
    ];
    for (const re of poPatterns) {
      const m = flat.match(re);
      if (m) { result.poNumber = m[1]; break; }
    }

    let poDateRaw = '';
    if (result.poNumber) {
      const idx = flat.indexOf(result.poNumber);
      const window = flat.slice(Math.max(0, idx - 30), idx + 100);
      const near = window.match(/Date\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i);
      if (near) poDateRaw = near[1];
    }
    if (!poDateRaw) {
      const all = [...flat.matchAll(/\bDate\s*[:.]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/gi)];
      for (const m of all) {
        if (/Delivery/i.test(flat.slice(Math.max(0, m.index - 25), m.index))) continue;
        poDateRaw = m[1];
        break;
      }
    }
    if (poDateRaw) result.poDate = parseDateToISO(poDateRaw);

    // HSN: 8-digit customs style often 8544xxxx — avoid pincode 560xxx and PO 45xxxx
    const hsnList = [];
    for (const m of flat.matchAll(/\b(\d{8})\b/g)) {
      const n = m[1];
      if (n.startsWith('45') || n.startsWith('56') || n.startsWith('91')) continue;
      hsnList.push(n);
    }

    const items = [];
    const unitAlt = 'AU|NOS|NO|EA|EACH|SET|MTR|KG|PCS|PC|UOM|UNITS?';

    // Pattern: DESC  QTY  UNIT  RATE  AMOUNT
    const reA = new RegExp(
      '([A-Za-z][A-Za-z0-9 ,\\-\\/()\\+]{4,100}?)\\s+' +
        '(\\d+(?:\\.\\d+)?)\\s*' +
        '(?:' + unitAlt + ')\\s+' +
        '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
        '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})',
      'gi'
    );
    let m;
    while ((m = reA.exec(flat)) !== null) {
      let desc = cleanDesc(m[1]);
      if (isNoiseDesc(desc)) continue;
      // strip "Redmi Pad..." only if it was stuck as separate terms block — keep product name
      const qty = parseMoney(m[2]);
      const a = parseMoney(m[3]);
      const b = parseMoney(m[4]);
      const picked = pickRateAndQty(qty, a, b);
      if (picked.rate >= 1 && picked.qty > 0) {
        items.push({
          desc: desc.slice(0, 150),
          qty: picked.qty,
          rate: picked.rate,
          unit: 'AU',
          hsn: '',
          disc: 0,
          gst: 18,
        });
      }
    }

    // Pattern: QTY UNIT RATE AMOUNT (desc before)
    if (!items.length) {
      const reB = new RegExp(
        '(\\d+(?:\\.\\d+)?)\\s*(' + unitAlt + ')\\s+' +
          '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
          '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})',
        'gi'
      );
      while ((m = reB.exec(flat)) !== null) {
        const qty = parseMoney(m[1]);
        const a = parseMoney(m[3]);
        const b = parseMoney(m[4]);
        const picked = pickRateAndQty(qty, a, b);
        if (picked.rate < 1) continue;
        const before = flat.slice(Math.max(0, m.index - 140), m.index);
        const dm = before.match(/([A-Za-z][A-Za-z0-9 ,\-\/()]{5,100})\s*$/);
        let desc = dm ? cleanDesc(dm[1]) : 'Item from PO';
        desc = desc.replace(/.*(DESCRIPTION|MATERIAL)\s+/i, '').trim();
        // Remove trailing garbage from address
        if (/Pilukhedi|Bangalore|Industrial|Plot\s*No/i.test(desc)) desc = 'Item from PO';
        if (isNoiseDesc(desc)) desc = 'Item from PO';
        items.push({
          desc: desc.slice(0, 150),
          qty: picked.qty,
          rate: picked.rate,
          unit: /NOS|NO|PCS/i.test(m[2] || '') ? 'Nos' : 'AU',
          hsn: '',
          disc: 0,
          gst: 18,
        });
      }
    }

    // Line-based
    if (!items.length) {
      const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const numLine = line.match(
          new RegExp(
            '^(\\d+(?:\\.\\d+)?)\\s*(' + unitAlt + ')?\\s+' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})\\s+' +
              '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+\\.\\d{2})$',
            'i'
          )
        );
        if (!numLine) continue;
        const qty = parseMoney(numLine[1]);
        const picked = pickRateAndQty(qty, parseMoney(numLine[3]), parseMoney(numLine[4]));
        if (picked.rate < 1) continue;
        let desc = 'Item from PO';
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const cand = cleanDesc(lines[j]);
          if (!isNoiseDesc(cand) && /[A-Za-z]{4}/.test(cand) && !/Plot|District|Tel|Email|GSTIN|CIN/i.test(cand)) {
            desc = cand;
            break;
          }
        }
        items.push({
          desc: desc.slice(0, 150),
          qty: picked.qty,
          rate: picked.rate,
          unit: /NOS/i.test(numLine[2] || '') ? 'Nos' : 'AU',
          hsn: '',
          disc: 0,
          gst: 18,
        });
      }
    }

    items.forEach((it, i) => {
      if (hsnList[i]) it.hsn = hsnList[i];
    });

    const seen = new Set();
    result.items = items.filter((it) => {
      const key = (it.desc + '|' + it.qty + '|' + it.rate).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      if (it.rate <= 28 && /gst/i.test(it.desc)) return false;
      return true;
    }).slice(0, 30);

    return result;
  }

  // ---------- Gemini AI parse ----------
  function getGeminiKey() {
    if (typeof GEMINI_API_KEY === 'string' && GEMINI_API_KEY.trim().length > 10) {
      return GEMINI_API_KEY.trim();
    }
    return '';
  }

  async function parsePoWithGemini(text) {
    const key = getGeminiKey();
    if (!key) return null;

    const prompt =
      'You extract purchase order data for an Indian tax invoice form.\n' +
      'From the PO text below, return ONLY valid JSON (no markdown) with this shape:\n' +
      '{\n' +
      '  "poNumber": "string",\n' +
      '  "poDate": "YYYY-MM-DD",\n' +
      '  "items": [\n' +
      '    { "desc": "material description only", "qty": number, "rate": number, "unit": "AU", "hsn": "string", "gst": 18 }\n' +
      '  ]\n' +
      '}\n' +
      'Rules:\n' +
      '- rate = UNIT rate (per piece), NOT line total / price amount\n' +
      '- If qty=2 and amount=39500 and rate column=19750, use rate 19750\n' +
      '- Do NOT include Bill To, Ship To, supplier address, GST lines, freight-only notes as items\n' +
      '- desc = product/service name only (not payment terms)\n' +
      '- poDate is PO date, not delivery date\n' +
      '- hsn if present else ""\n' +
      '- unit default AU\n\n' +
      'PO TEXT:\n' +
      text.slice(0, 12000);

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(key);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('AI parse failed: ' + res.status + ' ' + errText.slice(0, 120));
    }
    const data = await res.json();
    const raw =
      (((data || {}).candidates || [])[0] || {}).content ||
      {};
    const parts = raw.parts || [];
    let txt = parts.map((p) => p.text || '').join('\n').trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonMatch = txt.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI ne JSON nahi diya');
    const parsed = JSON.parse(jsonMatch[0]);

    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((it) => ({
            desc: String(it.desc || '').trim().slice(0, 200),
            qty: Number(it.qty) || 0,
            rate: Number(it.rate) || 0,
            unit: String(it.unit || 'AU').trim() || 'AU',
            hsn: String(it.hsn || '').trim(),
            disc: 0,
            gst: Number(it.gst) >= 0 ? Number(it.gst) : 18,
          }))
          .filter((it) => it.desc && it.qty > 0 && it.rate > 0)
      : [];

    let poDate = String(parsed.poDate || '').trim();
    if (poDate && !/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
      poDate = parseDateToISO(poDate) || '';
    }

    return {
      poNumber: String(parsed.poNumber || '').trim(),
      poDate,
      items,
      rawSnippet: text.slice(0, 400),
      source: 'ai',
    };
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
      const rows = {};
      content.items.forEach((it) => {
        const x = it.transform ? it.transform[4] : 0;
        const y = it.transform ? Math.round(it.transform[5]) : 0;
        const key = String(y);
        if (!rows[key]) rows[key] = [];
        rows[key].push({ x, str: it.str });
      });
      Object.keys(rows)
        .map(Number)
        .sort((a, b) => b - a)
        .forEach((y) => {
          text += rows[String(y)].sort((a, b) => a.x - b.x).map((c) => c.str).join(' ') + '\n';
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

    try {
      console.log('[PO import] text sample:', text.slice(0, 800));
    } catch (e) {}

    // AI first (if key set)
    if (getGeminiKey()) {
      try {
        const ai = await parsePoWithGemini(text);
        if (ai && (ai.poNumber || (ai.items && ai.items.length))) {
          try { console.log('[PO import] AI result:', ai); } catch (e) {}
          return ai;
        }
      } catch (e) {
        console.warn('[PO import] AI failed, using heuristic', e);
      }
    }

    const heuristic = parsePoTextHeuristic(text);
    heuristic.source = 'heuristic';
    try { console.log('[PO import] heuristic:', heuristic); } catch (e) {}
    return heuristic;
  }

  return { importFile, parsePoText: parsePoTextHeuristic };
})();
