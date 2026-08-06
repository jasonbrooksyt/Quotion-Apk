/* storage.js — thin wrapper around localStorage. Everything stays on-device. */

const Storage = (function () {
  const KEYS = {
    draft: 'qgen.draft.v1',
    company: 'qgen.company.v1',
    lastQuoteNo: 'qgen.lastQuoteNo.v1',
    customers: 'qgen.customers.v1',
    history: 'qgen.history.v1',
  };

  function isAvailable() {
    try {
      const t = '__qgen_test__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    if (!isAvailable()) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Read failed for', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    if (!isAvailable()) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Write failed for', key, e);
      return false;
    }
  }

  // ---------- Draft (current in-progress quotation) ----------

  function saveDraft(data) { return writeJSON(KEYS.draft, data); }
  function loadDraft() { return readJSON(KEYS.draft, null); }
  function clearDraft() { if (isAvailable()) localStorage.removeItem(KEYS.draft); }

  // ---------- Company (kept for compatibility; company header is now fixed in utils.js) ----------

  function saveCompany(data) { return writeJSON(KEYS.company, data); }
  function loadCompany() { return readJSON(KEYS.company, null); }

  // ---------- Quotation numbering ----------

  function getLastQuoteNo() {
    if (!isAvailable()) return null;
    return localStorage.getItem(KEYS.lastQuoteNo);
  }
  function setLastQuoteNo(no) {
    if (!isAvailable()) return;
    localStorage.setItem(KEYS.lastQuoteNo, no);
  }

  // ---------- Saved customers ----------
  // Stored as an object keyed by lowercased name so re-saving the same
  // customer updates rather than duplicates.

  function listCustomers() {
    const obj = readJSON(KEYS.customers, {});
    return Object.values(obj).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function saveCustomer(customer) {
    if (!customer || !customer.name || !customer.name.trim()) return false;
    const obj = readJSON(KEYS.customers, {});
    const key = customer.name.trim().toLowerCase();
    obj[key] = { ...customer, name: customer.name.trim() };
    return writeJSON(KEYS.customers, obj);
  }

  function deleteCustomer(name) {
    if (!name) return false;
    const obj = readJSON(KEYS.customers, {});
    const key = name.trim().toLowerCase();
    if (!(key in obj)) return false;
    delete obj[key];
    return writeJSON(KEYS.customers, obj);
  }

  // ---------- Quotation history (for re-opening/editing a generated quotation) ----------
  // Stored as an object keyed by quotation number.

  function listHistory() {
    const obj = readJSON(KEYS.history, {});
    return Object.values(obj).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }

  function saveToHistory(quoteData) {
    if (!quoteData || !quoteData.meta || !quoteData.meta.quoteNo) return false;
    const obj = readJSON(KEYS.history, {});
    obj[quoteData.meta.quoteNo] = { ...quoteData, savedAt: new Date().toISOString() };
    return writeJSON(KEYS.history, obj);
  }

  function getHistoryEntry(quoteNo) {
    const obj = readJSON(KEYS.history, {});
    return obj[quoteNo] || null;
  }

  function deleteHistoryEntry(quoteNo) {
    const obj = readJSON(KEYS.history, {});
    if (!(quoteNo in obj)) return false;
    delete obj[quoteNo];
    return writeJSON(KEYS.history, obj);
  }

  return {
    isAvailable,
    saveDraft, loadDraft, clearDraft,
    saveCompany, loadCompany,
    getLastQuoteNo, setLastQuoteNo,
    listCustomers, saveCustomer, deleteCustomer,
    listHistory, saveToHistory, getHistoryEntry, deleteHistoryEntry,
  };
})();
