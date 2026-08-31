/* po-import.js — PO upload → PO No, Date, items.
 * 1) Optional Gemini AI — key localStorage (phone) se, serial-config mein nahi
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
    // Prefer pair where unit_rate * qty ≈ line_total
    if (a > 0 && b > 0) {
      const errA = Math.abs(a * qty - b); // a is unit rate
      const errB = Math.abs(b * qty - a); // b is unit rate
      if (errA <= errB && errA <= Math.max(5, b * 0.1)) return { qty, rate: a };
      if (errB < errA && errB <= Math.max(5, a * 0.1)) return { qty, rate: b };
      // typical PO: unit rate < line total
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (lo >= 10 && Math.abs(lo * qty - hi) <= Math.max(5, hi * 0.1)) return { qty, rate: lo };
      if (hi >= 10) return { qty, rate: lo >= 10 ? lo : hi };
      return { qty, rate: lo };
    }
    if (a > 0 && b <= 0) {
      // reject tiny "rates" that are really qty echoes (e.g. rate=2)
      if (a < 10 && qty >= 1) return { qty, rate: 0 };
      if (qty > 1 && a / qty >= 10) return { qty, rate: Math.round((a / qty) * 100) / 100 };
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

    if (result.items[0]) result.subject = shortSubject(result.items[0].desc);

    return result;
  }



  /** Short subject from item description — e.g. "Mobile Tablet for Barcode scanner" → "Tablet supply" */
  function shortSubject(desc) {
    const d = String(desc || '').replace(/\s+/g, ' ').trim();
    if (!d) return '';
    const lower = d.toLowerCase();
    // Known product shortcuts
    if (/tablet/i.test(d) && /barcode|scanner|mobile/i.test(d)) return 'Tablet supply';
    if (/tablet/i.test(d)) return 'Tablet supply';
    if (/scanner/i.test(d)) return 'Scanner supply';
    if (/fabricat|ss\b|steel|structure|welding/i.test(d)) return 'Fabrication work';
    if (/motor|pump|gear/i.test(d)) return 'Equipment supply';
    if (/cable|wire/i.test(d)) return 'Cable supply';
    if (/panel|electrical/i.test(d)) return 'Panel work';
    // Generic: first 2–4 meaningful words, max ~40 chars
    const stop = new Set(['for', 'and', 'the', 'with', 'from', 'of', 'a', 'an', 'to', 'in', 'on']);
    const words = d.split(' ').filter((w) => w && !stop.has(w.toLowerCase()));
    let s = words.slice(0, 3).join(' ');
    if (s.length > 40) s = s.slice(0, 37).trim() + '…';
    // Prefer "... supply" if looks like a product name
    if (words.length && !/work|service|job|supply|repair/i.test(s)) {
      const core = words.slice(0, 2).join(' ');
      if (core.length <= 28) s = core + ' supply';
    }
    return s;
  }

  // ---------- Gemini AI parse (key from phone localStorage) ----------
  function getGeminiKey() {
    try {
      const local = localStorage.getItem('kmf_gemini_key');
      if (local && local.trim().length > 10) return local.trim();
    } catch (e) {}
    if (typeof GEMINI_API_KEY === 'string' && GEMINI_API_KEY.trim().length > 10) {
      return GEMINI_API_KEY.trim();
    }
    return '';
  }

  function buildPoPrompt(text) {
    return (
      'You are a data-entry assistant for Kanak Mechanicals tax invoices in India.\n' +
      'Read the Purchase Order (PO) text and extract ONLY these fields.\n\n' +
      'Return ONLY valid JSON (no markdown, no extra text):\n' +
      '{\n' +
      '  "poNumber": "string",\n' +
      '  "poDate": "YYYY-MM-DD",\n' +
      '  "items": [\n' +
      '    {\n' +
      '      "desc": "string",\n' +
      '      "qty": number,\n' +
      '      "rate": number,\n' +
      '      "unit": "AU",\n' +
      '      "hsn": "string",\n' +
      '      "gst": 18\n' +
      '    }\n' +
      '  ]\n' +
      '}\n\n' +
      '========== WHAT TO EXTRACT ==========\n' +
      '1) poNumber\n' +
      '   - Label: PO No. / PO Number / Purchase Order No.\n' +
      '   - Example: 45000084135\n\n' +
      '2) poDate\n' +
      '   - The DATE next to PO No. in the PO header box\n' +
      '   - Format output as YYYY-MM-DD (e.g. 19.08.2026 → 2026-08-19)\n' +
      '   - DO NOT use Delivery Date\n\n' +
      '3) items[] — one object per material/service LINE in the item table\n' +
      '   - desc: Material / service description from DESCRIPTION column only\n' +
      '     Example: "Mobile Tablet for Barcode scanner"\n' +
      '   - qty: Quantity number from QTY column (e.g. 2.000 → 2)\n' +
      '   - unit: Unit of measure (AU, NOS, EA, etc.). Default "AU"\n' +
      '   - rate: UNIT RATE from RATE (INR) column — price PER ONE unit\n' +
      '     Example: RATE 19,750.00 and PRICE 39,500.00 and QTY 2\n' +
      '              → rate = 19750  (NOT 39500)\n' +
      '   - hsn: HSN/SAC code if shown (e.g. 85446020), else ""\n' +
      '   - gst: 18 unless PO clearly shows another %\n\n' +
      '========== DO NOT EXTRACT ==========\n' +
      '- Bill To / Ship To / customer address / GSTIN of buyer\n' +
      '- Supplier address, phone, email\n' +
      '- CGST / SGST / IGST percentage rows as items\n' +
      '- Freight lines, payment terms, "OTHER TERMS", notes, Redmi specs in terms\n' +
      '- Grand total / TOTAL row as an item\n' +
      '- Subject field (user types subject manually)\n\n' +
      '========== RATE RULE (MOST IMPORTANT) ==========\n' +
      'rate MUST be unit rate, never line total.\n' +
      'If QTY=2, RATE=19750, PRICE/AMOUNT=39500 → "rate": 19750\n' +
      'If you only see one amount and qty>1, rate = amount / qty\n' +
      'Never set rate equal to qty (e.g. rate:2 is WRONG)\n\n' +
      '========== PO TEXT ==========\n' +
      text.slice(0, 14000)
    );
  }

  async function callGeminiModel(key, model, prompt) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      model +
      ':generateContent?key=' +
      encodeURIComponent(key);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
    });
    const errBody = !res.ok ? await res.text().catch(() => '') : '';
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = JSON.parse(errBody);
        msg = (j.error && j.error.message) || msg;
      } catch (e) {
        if (errBody) msg = errBody.slice(0, 160);
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    // blocked / empty
    const cand = ((data || {}).candidates || [])[0] || {};
    if (cand.finishReason && /SAFETY|RECITATION/i.test(cand.finishReason)) {
      throw new Error('AI blocked response: ' + cand.finishReason);
    }
    const parts = ((cand.content || {}).parts) || [];
    let txt = parts.map((p) => p.text || '').join('\n').trim();
    if (!txt && data.promptFeedback) {
      throw new Error('AI empty: ' + JSON.stringify(data.promptFeedback).slice(0, 120));
    }
    return txt;
  }

  function normalizeAiResult(parsed, text) {
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((it) => {
            let qty = Number(it.qty) || 0;
            let rate = Number(it.rate) || 0;
            // Safety: if rate looks like line total (rate ≈ qty * something common mistake)
            // leave as-is; prompt already insists unit rate
            return {
              desc: String(it.desc || '').trim().slice(0, 200),
              qty,
              rate,
              unit: String(it.unit || 'AU').trim() || 'AU',
              hsn: String(it.hsn || '').replace(/\D/g, '').slice(0, 8),
              disc: 0,
              gst: Number(it.gst) >= 0 ? Number(it.gst) : 18,
            };
          })
          .filter((it) => it.desc && it.qty > 0 && it.rate > 0)
      : [];

    let poDate = String(parsed.poDate || '').trim();
    if (poDate && !/^\d{4}-\d{2}-\d{2}$/.test(poDate)) {
      poDate = parseDateToISO(poDate) || '';
    }

    let subject = String(parsed.subject || '').trim().slice(0, 60);
    if (!subject && items[0]) subject = shortSubject(items[0].desc);

    return {
      poNumber: String(parsed.poNumber || '').trim(),
      poDate,
      subject,
      items,
      rawSnippet: (text || '').slice(0, 400),
      source: 'ai',
    };
  }

  async function parsePoWithGemini(text) {
    const key = getGeminiKey();
    if (!key) return null;

    const prompt = buildPoPrompt(text);
    // Try models in order (AI Studio free tier)
    // 2026: 2.0 / 1.5 shut down — use 3.x Flash; also try API list
    let models = [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ];
    try {
      const listed = await listGeminiModels(key);
      if (listed.length) {
        const ordered = models.filter((p) => listed.some((l) => l === p || l.startsWith(p)));
        models = ordered.length ? ordered.concat(listed.filter((l) => !ordered.includes(l)).slice(0, 3)) : listed.slice(0, 6);
      }
    } catch (e) {
      console.warn('[PO import] list models', e);
    }
    let lastErr = null;
    for (const model of models) {
      try {
        let txt = await callGeminiModel(key, model, prompt);
        txt = String(txt || '')
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastErr = new Error('AI JSON missing (' + model + ')');
          continue;
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const result = normalizeAiResult(parsed, text);
        result.model = model;
        if (!result.poNumber && !(result.items && result.items.length)) {
          lastErr = new Error('AI empty items (' + model + ')');
          continue;
        }
        return result;
      } catch (e) {
        lastErr = e;
        // 400 API key invalid — no point trying other models
        const msg = String(e.message || e);
        if (/API key|invalid|PERMISSION|403|401/i.test(msg) && e.status !== 404) {
          break;
        }
        continue;
      }
    }
    const err = lastErr || new Error('AI parse failed');
    err.isAi = true;
    throw err;
  }

  /** Quick key test for UI */
  async function listGeminiModels(key) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models?key=' +
      encodeURIComponent(key);
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('List models fail: ' + res.status + ' ' + body.slice(0, 120));
    }
    const data = await res.json();
    const names = [];
    (data.models || []).forEach((m) => {
      const id = String(m.name || '').replace(/^models\//, '');
      const actions = m.supportedGenerationMethods || m.supported_actions || [];
      if (actions.includes('generateContent') || !actions.length) {
        if (/gemini/i.test(id) && !/embed|image|tts|live|1\.5|2\.0/i.test(id)) names.push(id);
      }
    });
    return names;
  }

  async function testGeminiKey() {
    const key = getGeminiKey();
    if (!key) throw new Error('Pehle key Save on this phone karo');
    const preferred = [
      'gemini-3.6-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ];
    // Always try 3.6-flash first (Google current recommendation)
    let models = preferred.slice();
    try {
      const listed = await listGeminiModels(key);
      if (listed.length) {
        const ordered = preferred.filter((p) => listed.some((l) => l === p || l.startsWith(p)));
        const extra = listed.filter((l) => !models.includes(l) && !/1\.5|2\.0/i.test(l));
        models = (ordered.length ? ordered : preferred).concat(extra).slice(0, 6);
      }
    } catch (e) {
      console.warn('list models', e);
    }
    let lastErr = null;
    for (const model of models) {
      try {
        const txt = await callGeminiModel(key, model, 'Reply with JSON only: {"ok":true}');
        return { ok: true, model, txt };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('No working Gemini model');
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

    // AI first (if key set on this phone)
    if (getGeminiKey()) {
      try {
        const ai = await parsePoWithGemini(text);
        if (ai && (ai.poNumber || (ai.items && ai.items.length))) {
          try { console.log('[PO import] AI result:', ai); } catch (e) {}
          return ai;
        }
      } catch (e) {
        console.warn('[PO import] AI failed, using heuristic', e);
        const heuristic = parsePoTextHeuristic(text);
        heuristic.source = 'heuristic';
        heuristic.aiError = String(e.message || e);
        try { console.log('[PO import] heuristic:', heuristic); } catch (e2) {}
        return heuristic;
      }
    }

    const heuristic = parsePoTextHeuristic(text);
    heuristic.source = 'heuristic';
    try { console.log('[PO import] heuristic:', heuristic); } catch (e) {}
    return heuristic;
  }

  return { importFile, parsePoText: parsePoTextHeuristic, testGeminiKey, getGeminiKey, shortSubject };
})();
