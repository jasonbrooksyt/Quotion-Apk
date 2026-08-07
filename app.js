/* app.js — core UI logic. No frameworks. */

const QGenApp = (function () {

  let itemIdCounter = 0;
  const itemsWrap = document.getElementById('itemsWrap');
  const rowTemplate = document.getElementById('itemRowTemplate').querySelector('[data-row]');

  // ---------- Item row management ----------

  function createRow(values) {
    itemIdCounter += 1;
    const node = rowTemplate.cloneNode(true);
    node.dataset.id = itemIdCounter;
    if (values) {
      node.querySelector('[data-field="desc"]').value = values.desc || '';
      node.querySelector('[data-field="hsn"]').value = values.hsn || '';
      node.querySelector('[data-field="unit"]').value = values.unit || 'Each';
      node.querySelector('[data-field="qty"]').value = values.qty ?? 1;
      node.querySelector('[data-field="rate"]').value = values.rate ?? 0;
      node.querySelector('[data-field="disc"]').value = values.disc ?? 0;
      node.querySelector('[data-field="gst"]').value = values.gst ?? 18;
    }
    wireRow(node);
    return node;
  }

  function wireRow(node) {
    node.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', () => { recalcAll(); autosave(); });
    });
    node.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleRowAction(node, btn.dataset.action));
    });
  }

  function handleRowAction(node, action) {
    const rows = () => Array.from(itemsWrap.children);
    if (action === 'del') {
      if (rows().length === 1) { toast('At least one item row is required'); return; }
      node.remove();
    } else if (action === 'dup') {
      const clone = createRow(readRow(node));
      node.after(clone);
    } else if (action === 'up') {
      const prev = node.previousElementSibling;
      if (prev) itemsWrap.insertBefore(node, prev);
    } else if (action === 'down') {
      const next = node.nextElementSibling;
      if (next) itemsWrap.insertBefore(next, node);
    }
    renumberRows();
    recalcAll();
    autosave();
  }

  function renumberRows() {
    Array.from(itemsWrap.children).forEach((row, i) => {
      row.querySelector('.item-row__sno').textContent = 'Item ' + (i + 1);
    });
  }

  function addItem(values) {
    const node = createRow(values);
    itemsWrap.appendChild(node);
    renumberRows();
  }

  function readRow(node) {
    return {
      desc: node.querySelector('[data-field="desc"]').value,
      hsn: node.querySelector('[data-field="hsn"]').value,
      unit: node.querySelector('[data-field="unit"]').value,
      qty: parseFloat(node.querySelector('[data-field="qty"]').value) || 0,
      rate: parseFloat(node.querySelector('[data-field="rate"]').value) || 0,
      disc: parseFloat(node.querySelector('[data-field="disc"]').value) || 0,
      gst: parseFloat(node.querySelector('[data-field="gst"]').value) || 0,
    };
  }

  function readAllItems() {
    return Array.from(itemsWrap.children).map(readRow);
  }

  // ---------- Calculations ----------

  function computeItem(it) {
    const gross = it.qty * it.rate;
    const taxable = Utils.round2(gross - (gross * it.disc / 100));
    const gstAmt = Utils.round2(taxable * it.gst / 100);
    const lineTotal = Utils.round2(taxable + gstAmt);
    return { ...it, taxable, gstAmt, lineTotal };
  }

  function computeTotals(items, charges, gstType, overallDiscount) {
    const computed = items.map(computeItem);
    const taxable = Utils.round2(computed.reduce((s, r) => s + r.taxable, 0));
    const totalGst = Utils.round2(computed.reduce((s, r) => s + r.gstAmt, 0));
    const chargesTotal = Utils.round2(
      (charges.freight || 0) + (charges.insurance || 0) + (charges.loading || 0) + (charges.unloading || 0)
    );
    let cgst = 0, sgst = 0, igst = 0;
    if (gstType === 'IGST') {
      igst = totalGst;
    } else {
      cgst = Utils.round2(totalGst / 2);
      sgst = Utils.round2(totalGst - cgst);
    }
    const preRound = Utils.round2(taxable + totalGst + chargesTotal - (overallDiscount || 0));
    const finalAmount = Math.round(preRound);
    const roundOff = Utils.round2(finalAmount - preRound);
    return { computed, taxable, totalGst, cgst, sgst, igst, chargesTotal, preRound, roundOff, finalAmount };
  }

  function recalcAll() {
    Array.from(itemsWrap.children).forEach((row) => {
      const it = readRow(row);
      const c = computeItem(it);
      row.querySelector('[data-field="lineTotal"]').textContent = Utils.fmtMoney(c.lineTotal);
    });

    const items = readAllItems();
    const charges = {
      freight: parseFloat(document.getElementById('chargeFreight').value) || 0,
      insurance: parseFloat(document.getElementById('chargeInsurance').value) || 0,
      loading: parseFloat(document.getElementById('chargeLoading').value) || 0,
      unloading: parseFloat(document.getElementById('chargeUnloading').value) || 0,
    };
    const gstType = document.getElementById('gstType').value;
    const overallDiscount = parseFloat(document.getElementById('overallDiscount').value) || 0;
    const totals = computeTotals(items, charges, gstType, overallDiscount);

    document.getElementById('sumTaxable').textContent = Utils.fmtMoney(totals.taxable);
    document.getElementById('sumCharges').textContent = Utils.fmtMoney(totals.chargesTotal);
    document.getElementById('sumDiscount').textContent = Utils.fmtMoney(overallDiscount);
    document.getElementById('sumRound').textContent = Utils.fmtMoney(totals.roundOff);
    document.getElementById('sumGrand').textContent = Utils.fmtMoney(totals.finalAmount);

    const cgstRow = document.getElementById('sumCgstRow');
    const sgstRow = document.getElementById('sumSgstRow');
    const igstRow = document.getElementById('sumIgstRow');
    // Show rate in summary labels (e.g. CGST 9%)
    const rates = (totals.computed || []).map((it) => Number(it.gst) || 0).filter((r) => r > 0);
    const mainGst = rates.length ? rates[0] : 18;
    const half = Utils.round2(mainGst / 2);
    if (gstType === 'IGST') {
      cgstRow.style.display = 'none';
      sgstRow.style.display = 'none';
      igstRow.style.display = 'flex';
      igstRow.querySelector('span').textContent = 'IGST ' + mainGst + '%';
      document.getElementById('sumIgst').textContent = Utils.fmtMoney(totals.igst);
    } else {
      cgstRow.style.display = 'flex';
      sgstRow.style.display = 'flex';
      igstRow.style.display = 'none';
      cgstRow.querySelector('span').textContent = 'CGST ' + half + '%';
      sgstRow.querySelector('span').textContent = 'SGST ' + half + '%';
      document.getElementById('sumCgst').textContent = Utils.fmtMoney(totals.cgst);
      document.getElementById('sumSgst').textContent = Utils.fmtMoney(totals.sgst);
    }

    const currency = document.getElementById('currency').value;
    const currencyLabel = currency === 'USD' ? 'US Dollars' : 'Rupees';
    document.getElementById('sumWords').textContent = Utils.amountInWords(totals.finalAmount, currencyLabel);

    return totals;
  }

  // ---------- Data collection for export ----------

  function collectData() {
    const items = readAllItems();
    const charges = {
      freight: parseFloat(document.getElementById('chargeFreight').value) || 0,
      insurance: parseFloat(document.getElementById('chargeInsurance').value) || 0,
      loading: parseFloat(document.getElementById('chargeLoading').value) || 0,
      unloading: parseFloat(document.getElementById('chargeUnloading').value) || 0,
    };
    const gstType = document.getElementById('gstType').value;
    const overallDiscount = parseFloat(document.getElementById('overallDiscount').value) || 0;
    const totals = computeTotals(items, charges, gstType, overallDiscount);
    const currency = document.getElementById('currency').value;

    return {
      company: {
        name: COMPANY.name,
        gstin: COMPANY.gstin,
        address: COMPANY.addressLine,
        phone: COMPANY.phone,
        email: COMPANY.email,
      },
      customer: {
        name: document.getElementById('custName').value,
        address: document.getElementById('custAddress').value,
        gstin: document.getElementById('custGstin').value,
        contact: document.getElementById('custContact').value,
      },
      meta: {
        quoteNo: document.getElementById('quoteNo').value,
        date: document.getElementById('quoteDate').value,
        subject: document.getElementById('subject').value,
        gstType,
        currency,
      },
      terms: {
        deliveryTime: '',
        paymentTerms: '',
        remarks: '',
        termsText: (document.getElementById('termsText')?.value || DEFAULT_TERMS || '')
          .split('\n').map((s) => s.trim()).filter(Boolean),
      },
      charges,
      overallDiscount,
      totals,
    };
  }

  // ---------- Validation ----------

  function validate() {
    const errors = [];
    if (!document.getElementById('custName').value.trim()) errors.push('Customer name is required.');
    const items = readAllItems();
    if (items.length === 0) errors.push('At least one item is required.');
    items.forEach((it, i) => {
      if (!it.desc.trim()) errors.push(`Item ${i + 1}: description is required.`);
      if (!(it.qty > 0)) errors.push(`Item ${i + 1}: quantity must be greater than 0.`);
      if (!(it.rate >= 0)) errors.push(`Item ${i + 1}: rate is required.`);
    });
    return errors;
  }

  // ---------- Autosave / draft ----------

  let autosaveTimer = null;
  function autosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      Storage.saveDraft(collectData());
    }, 400);
  }

  function populateFormFromData(data) {
    document.getElementById('custName').value = data.customer?.name || '';
    document.getElementById('custAddress').value = data.customer?.address || '';
    document.getElementById('custGstin').value = data.customer?.gstin || '';
    document.getElementById('custContact').value = data.customer?.contact || '';

    document.getElementById('quoteNo').value = data.meta?.quoteNo || Utils.nextQuotationNumber(Storage.getLastQuoteNo());
    document.getElementById('quoteDate').value = data.meta?.date || Utils.todayISO();
    document.getElementById('subject').value = data.meta?.subject || '';
    document.getElementById('gstType').value = data.meta?.gstType || 'CGST_SGST';
    document.getElementById('currency').value = data.meta?.currency || 'INR';

    const termsEl = document.getElementById('termsText');
    if (termsEl) {
      termsEl.value = (data.terms?.termsText && data.terms.termsText.length)
        ? data.terms.termsText.join('\n')
        : (DEFAULT_TERMS || '');
    }

    document.getElementById('chargeFreight').value = data.charges?.freight ?? 0;
    document.getElementById('chargeInsurance').value = data.charges?.insurance ?? 0;
    document.getElementById('chargeLoading').value = data.charges?.loading ?? 0;
    document.getElementById('chargeUnloading').value = data.charges?.unloading ?? 0;
    document.getElementById('overallDiscount').value = data.overallDiscount ?? 0;

    itemsWrap.innerHTML = '';
    const items = data.totals?.computed?.length ? data.totals.computed : null;
    if (items) {
      items.forEach((it) => addItem(it));
    } else {
      addItem();
    }
    renumberRows();
  }

  function loadDraftIntoForm() {
    const draft = Storage.loadDraft();

    if (!draft) {
      addItem();
      document.getElementById('quoteDate').value = Utils.todayISO();
      document.getElementById('quoteNo').value = Utils.nextQuotationNumber(Storage.getLastQuoteNo());
      const termsEl = document.getElementById('termsText');
      if (termsEl) termsEl.value = DEFAULT_TERMS || '';
      if (typeof SerialSync !== 'undefined') {
        SerialSync.peekNext().then((no) => {
          const el = document.getElementById('quoteNo');
          if (el && (!el.value || el.value === Utils.nextQuotationNumber(Storage.getLastQuoteNo()) || el.value.startsWith('QT-'))) {
            // only overwrite if user has not typed a custom number
            if (!el.dataset.userEdited) el.value = no;
          }
        }).catch(() => {});
      }
      return;
    }

    populateFormFromData(draft);
  }

  // ---------- Saved customers ----------

  function loadCustomerIntoForm(found) {
    if (!found) return;
    document.getElementById('custName').value = found.name || '';
    document.getElementById('custAddress').value = found.address || '';
    document.getElementById('custGstin').value = found.gstin || '';
    document.getElementById('custContact').value = found.contact || '';
    const picker = document.getElementById('savedCustomerPicker');
    if (picker) picker.value = found.name || '';
    recalcAll();
    autosave();
  }

  async function refreshCustomerPicker() {
    const picker = document.getElementById('savedCustomerPicker');
    let customers = [];
    try {
      customers = typeof SerialSync !== 'undefined'
        ? await SerialSync.listCustomers()
        : Storage.listCustomers();
    } catch (e) {
      customers = Storage.listCustomers();
    }
    if (picker) {
      picker.innerHTML = '<option value="">— Select a saved customer —</option>' +
        customers.map((c) => `<option value="${Utils.escapeHtml(c.name)}">${Utils.escapeHtml(c.name)}</option>`).join('');
    }
    const list = document.getElementById('customerList');
    if (!list) return;
    if (!customers.length) {
      list.innerHTML = '<p class="hint">No saved customers yet.</p>';
      return;
    }
    list.innerHTML = customers.map((c) => {
      const name = Utils.escapeHtml(c.name || '');
      return `
        <div class="history-item" data-cust-name="${name}">
          <div class="history-item__info">
            <strong>${name}</strong>
            <span>${Utils.escapeHtml(c.gstin || '')}</span>
            <span>${Utils.escapeHtml((c.address || '').slice(0, 60))}</span>
          </div>
          <div class="history-item__actions">
            <button type="button" class="btn btn--secondary" data-action="edit">Edit</button>
            <button type="button" class="btn btn--ghost" data-action="delete">Delete</button>
          </div>
        </div>`;
    }).join('');
    list.querySelectorAll('.history-item').forEach((el) => {
      const name = el.dataset.custName;
      el.querySelector('[data-action="edit"]').addEventListener('click', async () => {
        let customers2 = [];
        try {
          customers2 = typeof SerialSync !== 'undefined' ? await SerialSync.listCustomers() : Storage.listCustomers();
        } catch (e) { customers2 = Storage.listCustomers(); }
        const found = customers2.find((c) => c.name === name);
        if (!found) { toast('Customer not found'); return; }
        loadCustomerIntoForm(found);
        toast('Loaded ' + name + ' for editing');
        if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm('Delete saved customer "' + name + '"?')) return;
        if (typeof SerialSync !== 'undefined') await SerialSync.deleteCustomer(name);
        else Storage.deleteCustomer(name);
        refreshCustomerPicker();
        toast('Customer deleted');
      });
    });
  }

  function wireCustomerPicker() {
    refreshCustomerPicker();

    const picker = document.getElementById('savedCustomerPicker');
    if (picker) {
      picker.addEventListener('change', async (e) => {
        const name = e.target.value;
        if (!name) return;
        let customers = [];
        try {
          customers = typeof SerialSync !== 'undefined' ? await SerialSync.listCustomers() : Storage.listCustomers();
        } catch (err) { customers = Storage.listCustomers(); }
        const found = customers.find((c) => c.name === name);
        if (!found) return;
        loadCustomerIntoForm(found);
      });
    }

    document.getElementById('saveCustomerBtn').addEventListener('click', async () => {
      const name = document.getElementById('custName').value.trim();
      if (!name) { toast('Enter a customer name first'); return; }
      const cust = {
        name,
        address: document.getElementById('custAddress').value,
        gstin: document.getElementById('custGstin').value,
        contact: document.getElementById('custContact').value,
      };
      if (typeof SerialSync !== 'undefined') await SerialSync.saveCustomer(cust);
      else Storage.saveCustomer(cust);
      await refreshCustomerPicker();
      if (picker) picker.value = name;
      toast('Customer saved / updated');
    });

    document.getElementById('deleteCustomerBtn').addEventListener('click', async () => {
      const name = picker ? picker.value : '';
      if (!name) { toast('Select a saved customer to delete'); return; }
      if (!confirm('Delete saved customer "' + name + '"?')) return;
      if (typeof SerialSync !== 'undefined') await SerialSync.deleteCustomer(name);
      else Storage.deleteCustomer(name);
      await refreshCustomerPicker();
      toast('Saved customer deleted');
    });
  }

  // ---------- Quotation history (edit a previously generated quotation) ----------

  async function refreshHistoryList() {
    const wrap = document.getElementById('historyList');
    if (!wrap) return;
    wrap.innerHTML = '<p class="hint">Loading…</p>';
    let entries = [];
    try {
      entries = typeof SerialSync !== 'undefined'
        ? await SerialSync.listHistory()
        : Storage.listHistory();
    } catch (e) {
      entries = Storage.listHistory();
    }
    const limit = (typeof HISTORY_EDIT_LIMIT === 'number') ? HISTORY_EDIT_LIMIT : 3;
    entries = (entries || []).slice(0, limit);
    if (!entries.length) {
      wrap.innerHTML = '<p class="hint">Last 3 quotations yahan dikhenge — Edit se form load hoga.</p>';
      return;
    }
    wrap.innerHTML = entries.map((entry) => {
      const grand = Utils.fmtMoney(entry.totals?.finalAmount || 0);
      const cust = Utils.escapeHtml(entry.customer?.name || '(no customer)');
      const no = Utils.escapeHtml(entry.meta?.quoteNo || '');
      const date = Utils.formatDateDMY(entry.meta?.date || '');
      return `
        <div class="history-item" data-quote-no="${no}">
          <div class="history-item__info">
            <strong>${no}</strong>
            <span>${cust}</span>
            <span>${date} · ₹${grand}</span>
          </div>
          <div class="history-item__actions">
            <button type="button" class="btn btn--secondary" data-action="edit">Edit</button>
            <button type="button" class="btn btn--ghost" data-action="delete">Delete</button>
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.history-item').forEach((el) => {
      const quoteNo = el.dataset.quoteNo;
      el.querySelector('[data-action="edit"]').addEventListener('click', async () => {
        let entry = null;
        try {
          entry = typeof SerialSync !== 'undefined'
            ? await SerialSync.getHistoryEntry(quoteNo)
            : Storage.getHistoryEntry(quoteNo);
        } catch (e) {
          entry = Storage.getHistoryEntry(quoteNo);
        }
        if (!entry) { toast('Could not find that quotation'); return; }
        populateFormFromData(entry);
        recalcAll();
        autosave();
        if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Loaded ' + quoteNo + ' for editing');
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm('Delete quotation ' + quoteNo + ' from history?')) return;
        if (typeof SerialSync !== 'undefined') await SerialSync.deleteHistoryEntry(quoteNo);
        else Storage.deleteHistoryEntry(quoteNo);
        refreshHistoryList();
      });
    });
  }

  // ---------- Error banner (visible, scroll-to, not hidden behind keyboard) ----------

  function showErrors(errors) {
    const banner = document.getElementById('errorBanner');
    banner.innerHTML = '<strong>Please fix before generating:</strong><ul>' +
      errors.map((e) => `<li>${Utils.escapeHtml(e)}</li>`).join('') + '</ul>';
    banner.classList.remove('hidden');
    if (typeof banner.scrollIntoView === 'function') {
      banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function hideErrors() {
    document.getElementById('errorBanner').classList.add('hidden');
  }

  // ---------- Toast ----------

  let toastEl = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('toast--show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('toast--show'), 2200);
  }

  // ---------- Wiring ----------

  function wireStaticControls() {
    const qn = document.getElementById('quoteNo');
    if (qn) qn.addEventListener('input', () => { qn.dataset.userEdited = '1'; });
    document.getElementById('addItemBtn').addEventListener('click', () => {
      addItem();
      recalcAll();
      autosave();
    });

    ['chargeFreight', 'chargeInsurance', 'chargeLoading', 'chargeUnloading', 'overallDiscount', 'gstType', 'currency']
      .forEach((id) => document.getElementById(id).addEventListener('input', () => { recalcAll(); autosave(); }));

    document.querySelectorAll('.card input, .card select, .card textarea').forEach((el) => {
      if (!el.closest('[data-row]')) {
        el.addEventListener('input', autosave);
      }
    });

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!confirm('Clear the entire form? This cannot be undone.')) return;
      Storage.clearDraft();
      itemsWrap.innerHTML = '';
      document.querySelectorAll('.card input, .card textarea')
        .forEach((el) => { if (el.type !== 'date') el.value = ''; });
      document.getElementById('quoteDate').value = Utils.todayISO();
      document.getElementById('quoteNo').value = Utils.nextQuotationNumber(Storage.getLastQuoteNo());
      const termsEl = document.getElementById('termsText');
      if (termsEl) termsEl.value = DEFAULT_TERMS || '';
      addItem();
      recalcAll();
    });

    document.getElementById('genPdfBtn').addEventListener('click', async () => {
      const errors = validate();
      if (errors.length) { showErrors(errors); return; }
      hideErrors();
      const btn = document.getElementById('genPdfBtn');
      btn.disabled = true;
      try {
        if (typeof SerialSync !== 'undefined') {
          const reserved = await SerialSync.reserveNext();
          document.getElementById('quoteNo').value = reserved.quoteNo;
          if (reserved.source === 'cloud') toast('Serial synced: ' + reserved.quoteNo);
        }
        const data = collectData();
        Storage.setLastQuoteNo(data.meta.quoteNo);
        if (typeof SerialSync !== 'undefined') await SerialSync.saveHistory(data);
        else Storage.saveToHistory(data);
        await refreshHistoryList();
        PdfExport.generate(data);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('genDocxBtn').addEventListener('click', async () => {
      const errors = validate();
      if (errors.length) { showErrors(errors); return; }
      hideErrors();
      const btn = document.getElementById('genDocxBtn');
      btn.disabled = true;
      try {
        if (typeof SerialSync !== 'undefined') {
          const reserved = await SerialSync.reserveNext();
          document.getElementById('quoteNo').value = reserved.quoteNo;
          if (reserved.source === 'cloud') toast('Serial synced: ' + reserved.quoteNo);
        }
        const data = collectData();
        Storage.setLastQuoteNo(data.meta.quoteNo);
        if (typeof SerialSync !== 'undefined') await SerialSync.saveHistory(data);
        else Storage.saveToHistory(data);
        await refreshHistoryList();
        DocxExport.generate(data);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function isUnlocked() {
    return sessionStorage.getItem('kmf_unlocked') === '1';
  }

  function unlockApp() {
    sessionStorage.setItem('kmf_unlocked', '1');
    const login = document.getElementById('loginScreen');
    const shell = document.getElementById('appShell');
    if (login) login.classList.add('hidden');
    if (shell) shell.classList.remove('hidden');
  }

  function lockApp() {
    sessionStorage.removeItem('kmf_unlocked');
    const login = document.getElementById('loginScreen');
    const shell = document.getElementById('appShell');
    if (shell) shell.classList.add('hidden');
    if (login) login.classList.remove('hidden');
    const pin = document.getElementById('pinInput');
    if (pin) pin.value = '';
  }

  function wireLogin() {
    const pinInput = document.getElementById('pinInput');
    const pinBtn = document.getElementById('pinSubmitBtn');
    const pinErr = document.getElementById('pinError');
    const expected = (typeof APP_PIN === 'string') ? APP_PIN : '112266';

    function tryUnlock() {
      const val = (pinInput && pinInput.value) ? pinInput.value.trim() : '';
      if (val === expected) {
        if (pinErr) pinErr.classList.add('hidden');
        unlockApp();
        initApp();
      } else {
        if (pinErr) pinErr.classList.remove('hidden');
        if (pinInput) { pinInput.value = ''; pinInput.focus(); }
      }
    }

    if (pinBtn) pinBtn.addEventListener('click', tryUnlock);
    if (pinInput) {
      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryUnlock();
      });
    }
    const logout = document.getElementById('logoutBtn');
    if (logout) logout.addEventListener('click', () => {
      if (confirm('Lock the app?')) lockApp();
    });
  }

  function initApp() {
    if (!Storage.isAvailable()) {
      const w = document.getElementById('storageWarning');
      if (w) w.classList.remove('hidden');
    }
    if (typeof SerialSync !== 'undefined' && !SerialSync.isConfigured()) {
      const w = document.getElementById('storageWarning');
      if (w) {
        w.textContent = '⚠ Firebase URL serial-config.js mein set nahi hai — shared serial/history off hai.';
        w.classList.remove('hidden');
      }
    }
    wireStaticControls();
    wireCustomerPicker();
    loadDraftIntoForm();
    refreshHistoryList();
    recalcAll();
  }

  function init() {
    wireLogin();
    if (isUnlocked()) {
      unlockApp();
      initApp();
    } else {
      const pin = document.getElementById('pinInput');
      if (pin) setTimeout(() => pin.focus(), 100);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { collectData, computeTotals, recalcAll, toast };
})();
