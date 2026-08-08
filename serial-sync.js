/* serial-sync.js — Shared serial + customers + history via Supabase REST */

const SerialSync = (function () {

  function isConfigured() {
    return typeof SUPABASE_URL === 'string' && SUPABASE_URL.trim().length > 10
      && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.trim().length > 20;
  }

  function headers(extra) {
    var h = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function rest(path) {
    return SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path;
  }

  async function sbFetch(path, opts) {
    opts = opts || {};
    var res = await fetch(rest(path), {
      method: opts.method || 'GET',
      headers: headers(opts.headers),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      var t = await res.text().catch(function () { return ''; });
      throw new Error((opts.method || 'GET') + ' ' + path + ' ' + res.status + ' ' + t);
    }
    if (res.status === 204) return null;
    var text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  function yearPrefix() {
    return 'QT-' + new Date().getFullYear() + '-';
  }

  function formatNo(seq) {
    return yearPrefix() + String(seq).padStart(4, '0');
  }

  function parseSeq(quoteNo) {
    if (!quoteNo) return 0;
    var m = String(quoteNo).match(/QT-(\d{4})-(\d+)/);
    if (!m) return 0;
    if (Number(m[1]) !== new Date().getFullYear()) return 0;
    return Number(m[2]) || 0;
  }

  function parseInvSeq(no) {
    if (!no) return 0;
    var fy = Utils.financialYearLabel(new Date());
    var m = String(no).match(/GST\/(\d{2}-\d{2})\/(\d+)/i);
    if (!m || m[1] !== fy) return 0;
    return Number(m[2]) || 0;
  }

  function formatInvNo(seq) {
    var fy = Utils.financialYearLabel(new Date());
    return 'GST/' + fy + '/' + String(seq).padStart(4, '0');
  }

  async function peekNext() {
    if (!isConfigured()) {
      return Utils.nextQuotationNumber(Storage.getLastQuoteNo());
    }
    try {
      var rows = await sbFetch('kmf_counter?id=eq.1&select=last_seq,last_no');
      var row = rows && rows[0];
      var last = row && typeof row.last_seq === 'number' ? row.last_seq : 0;
      var localLast = parseSeq(Storage.getLastQuoteNo());
      return formatNo(Math.max(last, localLast) + 1);
    } catch (e) {
      console.warn('peekNext', e);
      return Utils.nextQuotationNumber(Storage.getLastQuoteNo());
    }
  }

  async function reserveNext() {
    function localFallback() {
      var no = Utils.nextQuotationNumber(Storage.getLastQuoteNo());
      Storage.setLastQuoteNo(no);
      return { quoteNo: no, source: 'local' };
    }
    if (!isConfigured()) return localFallback();
    try {
      var rows = await sbFetch('kmf_counter?id=eq.1&select=last_seq,last_no');
      var row = rows && rows[0];
      var lastSeq = row && typeof row.last_seq === 'number' ? row.last_seq : 0;
      var localLast = parseSeq(Storage.getLastQuoteNo());
      if (localLast > lastSeq) lastSeq = localLast;
      var nextSeq = lastSeq + 1;
      var quoteNo = formatNo(nextSeq);
      await sbFetch('kmf_counter?id=eq.1', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: {
          last_seq: nextSeq,
          last_no: quoteNo,
          updated_at: new Date().toISOString(),
        },
      });
      Storage.setLastQuoteNo(quoteNo);
      return { quoteNo: quoteNo, source: 'cloud' };
    } catch (e) {
      console.warn('reserveNext', e);
      return localFallback();
    }
  }

  async function peekInvoiceNext() {
    if (!isConfigured()) {
      return Utils.nextInvoiceNumber(localStorage.getItem('qgen.lastInvoiceNo.v1'));
    }
    try {
      var rows = await sbFetch('kmf_counter?id=eq.1&select=last_inv_seq,last_inv_no');
      var row = rows && rows[0];
      var last = row && typeof row.last_inv_seq === 'number' ? row.last_inv_seq : 0;
      var localLast = parseInvSeq(localStorage.getItem('qgen.lastInvoiceNo.v1'));
      return formatInvNo(Math.max(last, localLast) + 1);
    } catch (e) {
      console.warn('peekInvoiceNext', e);
      return Utils.nextInvoiceNumber(localStorage.getItem('qgen.lastInvoiceNo.v1'));
    }
  }

  async function reserveInvoiceNext() {
    function localFallback() {
      var no = Utils.nextInvoiceNumber(localStorage.getItem('qgen.lastInvoiceNo.v1'));
      localStorage.setItem('qgen.lastInvoiceNo.v1', no);
      return { quoteNo: no, source: 'local' };
    }
    if (!isConfigured()) return localFallback();
    try {
      var rows = await sbFetch('kmf_counter?id=eq.1&select=last_inv_seq,last_inv_no');
      var row = rows && rows[0];
      var lastSeq = row && typeof row.last_inv_seq === 'number' ? row.last_inv_seq : 0;
      var localLast = parseInvSeq(localStorage.getItem('qgen.lastInvoiceNo.v1'));
      if (localLast > lastSeq) lastSeq = localLast;
      var nextSeq = lastSeq + 1;
      var invNo = formatInvNo(nextSeq);
      await sbFetch('kmf_counter?id=eq.1', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: {
          last_inv_seq: nextSeq,
          last_inv_no: invNo,
          updated_at: new Date().toISOString(),
        },
      });
      localStorage.setItem('qgen.lastInvoiceNo.v1', invNo);
      return { quoteNo: invNo, source: 'cloud' };
    } catch (e) {
      console.warn('reserveInvoiceNext', e);
      return localFallback();
    }
  }

  async function saveHistory(quoteData) {
    if (!quoteData || !quoteData.meta || !quoteData.meta.quoteNo) return false;
    var quoteNo = quoteData.meta.quoteNo;
    var payload = Object.assign({}, quoteData, { savedAt: new Date().toISOString() });
    Storage.saveToHistory(quoteData);
    if (!isConfigured()) return true;
    try {
      await sbFetch('kmf_history', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: {
          quote_no: quoteNo,
          payload: payload,
          saved_at: payload.savedAt,
        },
      });
      await trimHistory(30);
      return true;
    } catch (e) {
      console.warn('saveHistory', e);
      return false;
    }
  }

  async function listHistory() {
    if (isConfigured()) {
      try {
        var rows = await sbFetch('kmf_history?select=quote_no,payload,saved_at&order=saved_at.desc&limit=30');
        if (Array.isArray(rows)) {
          return rows.map(function (r) {
            var p = r.payload || {};
            if (!p.savedAt && r.saved_at) p.savedAt = r.saved_at;
            if (!p.meta) p.meta = {};
            if (!p.meta.quoteNo) p.meta.quoteNo = r.quote_no;
            return p;
          });
        }
      } catch (e) {
        console.warn('listHistory', e);
      }
    }
    return Storage.listHistory();
  }

  async function getHistoryEntry(quoteNo) {
    if (isConfigured()) {
      try {
        var rows = await sbFetch('kmf_history?quote_no=eq.' + encodeURIComponent(quoteNo) + '&select=payload,saved_at');
        if (rows && rows[0] && rows[0].payload) {
          var p = rows[0].payload;
          if (!p.savedAt && rows[0].saved_at) p.savedAt = rows[0].saved_at;
          return p;
        }
      } catch (e) { /* fall through */ }
    }
    return Storage.getHistoryEntry(quoteNo);
  }

  async function deleteHistoryEntry(quoteNo) {
    Storage.deleteHistoryEntry(quoteNo);
    if (!isConfigured()) return true;
    try {
      await sbFetch('kmf_history?quote_no=eq.' + encodeURIComponent(quoteNo), {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' },
      });
      return true;
    } catch (e) {
      console.warn('deleteHistory', e);
      return false;
    }
  }

  async function trimHistory(keep) {
    try {
      var rows = await sbFetch('kmf_history?select=quote_no,saved_at&order=saved_at.desc');
      if (!Array.isArray(rows) || rows.length <= keep) return;
      for (var i = keep; i < rows.length; i++) {
        await sbFetch('kmf_history?quote_no=eq.' + encodeURIComponent(rows[i].quote_no), {
          method: 'DELETE',
          headers: { 'Prefer': 'return=minimal' },
        });
      }
    } catch (e) {
      console.warn('trimHistory', e);
    }
  }

  async function listCustomers() {
    if (isConfigured()) {
      try {
        var rows = await sbFetch('kmf_customers?select=payload&order=name_key.asc');
        if (Array.isArray(rows)) {
          return rows.map(function (r) { return r.payload; }).filter(Boolean)
            .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
        }
      } catch (e) {
        console.warn('listCustomers', e);
      }
    }
    return Storage.listCustomers();
  }

  async function saveCustomer(customer) {
    if (!customer || !customer.name || !customer.name.trim()) return false;
    var name = customer.name.trim();
    var key = name.toLowerCase().replace(/[^\w-]/g, '_');
    var payload = Object.assign({}, customer, { name: name });
    Storage.saveCustomer(payload);
    if (!isConfigured()) return false;
    try {
      await sbFetch('kmf_customers', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: { name_key: key, payload: payload },
      });
      return true;
    } catch (e) {
      console.warn('saveCustomer', e);
      return false;
    }
  }

  async function deleteCustomer(name) {
    if (!name) return false;
    var key = name.trim().toLowerCase().replace(/[^\w-]/g, '_');
    Storage.deleteCustomer(name);
    if (!isConfigured()) return true;
    try {
      await sbFetch('kmf_customers?name_key=eq.' + encodeURIComponent(key), {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' },
      });
      return true;
    } catch (e) {
      console.warn('deleteCustomer', e);
      return false;
    }
  }

  return {
    isConfigured: isConfigured,
    peekNext: peekNext,
    reserveNext: reserveNext,
    peekInvoiceNext: peekInvoiceNext,
    reserveInvoiceNext: reserveInvoiceNext,
    saveHistory: saveHistory,
    listHistory: listHistory,
    getHistoryEntry: getHistoryEntry,
    deleteHistoryEntry: deleteHistoryEntry,
    listCustomers: listCustomers,
    saveCustomer: saveCustomer,
    deleteCustomer: deleteCustomer,
  };
})();
