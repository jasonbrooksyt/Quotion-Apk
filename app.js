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
      node.querySelector('[data-field="unit"]').value = values.unit || 'AU';
      node.querySelector('[data-field="qty"]').value = values.qty ?? 1;
      node.querySelector('[data-field="rate"]').value = (values.rate != null && values.rate !== '') ? values.rate : '';
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
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const disc = Number(it.disc) || 0;
    const gst = Number(it.gst) || 0;
    const gross = Utils.round2(qty * rate);
    const discAmt = Utils.round2(gross * disc / 100);
    const taxable = Utils.round2(gross - discAmt);
    const gstAmt = Utils.round2(taxable * gst / 100);
    const lineTotal = Utils.round2(taxable + gstAmt);
    return { ...it, qty, rate, disc, gst, gross, discAmt, taxable, gstAmt, lineTotal };
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
      const lt = row.querySelector('[data-field="lineTotal"]');
      if (lt) lt.textContent = Utils.fmtMoney(c.lineTotal);
      let discEl = row.querySelector('[data-field="discAmtShow"]');
      if (!discEl) {
        const wrap = row.querySelector('.item-row__amount');
        if (wrap) {
          discEl = document.createElement('span');
          discEl.className = 'item-row__disc';
          discEl.setAttribute('data-field', 'discAmtShow');
          wrap.insertBefore(discEl, wrap.firstChild);
        }
      }
      if (discEl) {
        discEl.textContent = c.discAmt > 0 ? ('Disc ₹' + Utils.fmtMoney(c.discAmt) + ' · ') : '';
      }
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
        docType: (document.getElementById('docType') || {}).value || 'quotation',
        quoteNo: document.getElementById('quoteNo').value,
        date: document.getElementById('quoteDate').value,
        subject: document.getElementById('subject').value,
        gstType,
        currency,
        poNumber: (document.getElementById('poNumber') || {}).value || '',
        poDate: (document.getElementById('poDate') || {}).value || '',
      },
      bank: (typeof BANK !== 'undefined') ? BANK : null,
      terms: {
        deliveryTime: '',
        paymentTerms: '',
        remarks: '',
        termsText: ((document.getElementById('docType') || {}).value === 'invoice')
          ? []
          : (document.getElementById('termsText')?.value || DEFAULT_TERMS || '')
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
      if (!(Number(it.rate) > 0)) errors.push(`Item ${i + 1}: rate is required.`);
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
    const dt = document.getElementById('docType');
    const dtype = data.meta?.docType || 'quotation';
    if (dt) dt.value = dtype;
    document.querySelectorAll('.doc-type-opt').forEach((btn) => {
      btn.classList.toggle('doc-type-opt--active', btn.dataset.type === dtype);
    });
    const hero = document.getElementById('docTypeHero');
    if (hero) {
      hero.classList.toggle('doc-type-hero--invoice', dtype === 'invoice');
      hero.classList.toggle('doc-type-hero--quotation', dtype === 'quotation');
    }
    const poN = document.getElementById('poNumber');
    if (poN) poN.value = data.meta?.poNumber || '';
    const poD = document.getElementById('poDate');
    if (poD) poD.value = data.meta?.poDate || '';
    if (typeof window.syncDocTypeUI === 'function') window.syncDocTypeUI();

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

  function ensureQuoteDate() {
    const el = document.getElementById('quoteDate');
    if (el && !el.value) el.value = Utils.todayISO();
  }

  function loadDraftIntoForm() {
    const draft = Storage.loadDraft();

    if (!draft) {
      addItem();
      document.getElementById('quoteDate').value = Utils.todayISO();
      document.getElementById('quoteNo').value = Utils.nextQuotationNumber(Storage.getLastQuoteNo());
      ensureQuoteDate();
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
    ensureQuoteDate();
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
    if (!picker) return;
    const prev = picker.value;
    picker.innerHTML = '<option value="">— Select a saved customer —</option>' +
      customers.map((c) => `<option value="${Utils.escapeHtml(c.name)}">${Utils.escapeHtml(c.name)}</option>`).join('');
    // keep selection if still exists
    if (prev && customers.some((c) => c.name === prev)) picker.value = prev;
    updateCustomerActionHint();
  }

  function updateCustomerActionHint() {
    const hint = document.getElementById('customerActionHint');
    const picker = document.getElementById('savedCustomerPicker');
    if (!hint) return;
    const name = picker && picker.value;
    if (name) {
      hint.textContent = '"' + name + '" selected — form mein edit karke Save / Update, ya Delete Selected se hatao.';
    } else {
      hint.textContent = 'Dropdown se customer select karo — form load hoga. Phir Save / Update ya Delete Selected use karo.';
    }
  }

  function wireCustomerPicker() {
    refreshCustomerPicker();

    const picker = document.getElementById('savedCustomerPicker');
    if (picker) {
      picker.addEventListener('change', async (e) => {
        const name = e.target.value;
        updateCustomerActionHint();
        if (!name) return;
        let customers = [];
        try {
          customers = typeof SerialSync !== 'undefined' ? await SerialSync.listCustomers() : Storage.listCustomers();
        } catch (err) { customers = Storage.listCustomers(); }
        const found = customers.find((c) => c.name === name);
        if (!found) return;
        loadCustomerIntoForm(found);
        toast('Loaded: ' + name);
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
      let ok = true;
      if (typeof SerialSync !== 'undefined') {
        ok = await SerialSync.saveCustomer(cust);
        if (!ok && SerialSync.isConfigured()) toast('Saved on phone, cloud sync failed — check internet');
        else if (ok && SerialSync.isConfigured()) toast('Customer saved (synced both phones)');
        else toast('Customer saved on this phone only (Supabase not set)');
      } else {
        Storage.saveCustomer(cust);
        toast('Customer saved / updated');
      }
      await refreshCustomerPicker();
      if (picker) picker.value = name;
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

  function isInvoiceEntry(entry) {
    const dt = entry && entry.meta && entry.meta.docType;
    if (dt === 'invoice') return true;
    if (dt === 'quotation') return false;
    const no = (entry && entry.meta && entry.meta.quoteNo) || '';
    return /^GST\//i.test(String(no));
  }

  async function refreshHistoryList() {
    const wrap = document.getElementById('historyList');
    if (!wrap) return;
    const docType = (document.getElementById('docType') || {}).value || 'quotation';
    const wantInvoice = docType === 'invoice';
    const titleEl = document.getElementById('historyTitle');
    if (titleEl) {
      titleEl.textContent = wantInvoice
        ? 'Recent Invoices (Edit last 3)'
        : 'Recent Quotations (Edit last 3)';
    }
    wrap.innerHTML = '<p class="hint">Loading…</p>';
    let entries = [];
    try {
      entries = typeof SerialSync !== 'undefined'
        ? await SerialSync.listHistory()
        : Storage.listHistory();
    } catch (e) {
      entries = Storage.listHistory();
    }
    // Only same document type (quotation vs invoice)
    entries = (entries || []).filter((e) => isInvoiceEntry(e) === wantInvoice);
    const limit = (typeof HISTORY_EDIT_LIMIT === 'number') ? HISTORY_EDIT_LIMIT : 3;
    entries = entries.slice(0, limit);
    if (!entries.length) {
      wrap.innerHTML = wantInvoice
        ? '<p class="hint">Last 3 invoices yahan dikhenge — Edit se form load hoga.</p>'
        : '<p class="hint">Last 3 quotations yahan dikhenge — Edit se form load hoga.</p>';
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
        if (!entry) { toast('Could not find that entry'); return; }
        populateFormFromData(entry);
        recalcAll();
        autosave();
        if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Loaded ' + quoteNo + ' for editing');
      });
      el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm('Delete ' + quoteNo + ' from history?')) return;
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

    function isInvoiceNo(no) {
      return /^GST\/\d{2}-\d{2}\/\d+/i.test(String(no || ''));
    }

    function updateDocNoLabel(isInv) {
      const label = document.getElementById('docNoLabel');
      if (!label) return;
      let textNode = null;
      for (const n of label.childNodes) {
        if (n.nodeType === 3) { textNode = n; break; }
      }
      const title = (isInv ? 'Invoice No.' : 'Quotation No.') + ' ';
      if (textNode) textNode.textContent = title;
      else label.insertBefore(document.createTextNode(title), label.firstChild);
    }

    window.syncDocTypeUI = function (forceNumber) {
      const dt = document.getElementById('docType');
      const type = dt ? dt.value : 'quotation';
      const isInv = type === 'invoice';

      const poRow = document.getElementById('poRow');
      if (poRow) poRow.style.display = isInv ? 'block' : 'none';

      const termsCard = document.getElementById('termsCard');
      if (termsCard) termsCard.style.display = isInv ? 'none' : '';

      updateDocNoLabel(isInv);

      const hint = document.getElementById('docTypeHint');
      if (hint) {
        hint.textContent = isInv
          ? 'Tax Invoice PDF — bank details + UPI QR (total amount).'
          : 'Quotation PDF. Invoice mode mein UPI QR + bank details aayenge.';
      }

      const qnEl = document.getElementById('quoteNo');
      if (qnEl) {
        const wrongType = (isInv && !isInvoiceNo(qnEl.value)) || (!isInv && isInvoiceNo(qnEl.value));
        const mustForce = forceNumber || !qnEl.dataset.userEdited || wrongType;
        if (mustForce) {
          delete qnEl.dataset.userEdited;
          if (isInv) {
            qnEl.value = Utils.nextInvoiceNumber(localStorage.getItem('qgen.lastInvoiceNo.v1'));
            if (typeof SerialSync !== 'undefined' && SerialSync.isConfigured()) {
              SerialSync.peekInvoiceNext().then((no) => {
                if (!qnEl.dataset.userEdited && (document.getElementById('docType') || {}).value === 'invoice') {
                  qnEl.value = no;
                }
              }).catch(() => {});
            }
          } else {
            qnEl.value = Utils.nextQuotationNumber(Storage.getLastQuoteNo());
            if (typeof SerialSync !== 'undefined') {
              SerialSync.peekNext().then((no) => {
                if (!qnEl.dataset.userEdited && (document.getElementById('docType') || {}).value !== 'invoice') {
                  qnEl.value = no;
                }
              }).catch(() => {});
            }
          }
        }
      }
    };

    function setDocType(type, opts) {
      opts = opts || {};
      type = (type === 'invoice') ? 'invoice' : 'quotation';
      const hidden = document.getElementById('docType');
      if (hidden) hidden.value = type;

      document.querySelectorAll('.doc-type-opt').forEach((btn) => {
        const on = btn.getAttribute('data-type') === type;
        btn.classList.toggle('doc-type-opt--active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      const hero = document.getElementById('docTypeHero');
      if (hero) {
        hero.classList.toggle('doc-type-hero--invoice', type === 'invoice');
        hero.classList.toggle('doc-type-hero--quotation', type === 'quotation');
      }
      const heroHint = document.getElementById('docTypeHeroHint');
      if (heroHint) {
        heroHint.textContent = type === 'invoice'
          ? 'Tax Invoice mode — GST/… number, bank + UPI QR on PDF'
          : 'Quotation mode — QT-… number, terms on PDF';
      }

      if (!opts.skipNumber) {
        const qnEl = document.getElementById('quoteNo');
        if (qnEl) delete qnEl.dataset.userEdited;
        if (typeof window.syncDocTypeUI === 'function') window.syncDocTypeUI(true);
      }
      if (!opts.silent) autosave();
      // History list: only show same type (quotation / invoice)
      refreshHistoryList();
    }
    window.setDocType = setDocType;

    // Event delegation — works even if inner spans are clicked
    const heroEl = document.getElementById('docTypeHero');
    if (heroEl) {
      heroEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.doc-type-opt');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        setDocType(btn.getAttribute('data-type'));
      });
    }

    const docTypeEl = document.getElementById('docType');
    const initial = (docTypeEl && docTypeEl.value) ? docTypeEl.value : 'quotation';
    setDocType(initial, { silent: true });
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

    function clearForm(keepDocType) {
      const keepType = keepDocType
        ? ((document.getElementById('docType') || {}).value || 'quotation')
        : 'quotation';
      Storage.clearDraft();
      itemsWrap.innerHTML = '';
      document.querySelectorAll('.card input, .card textarea')
        .forEach((el) => { if (el.type !== 'date') el.value = ''; });
      const dateEl = document.getElementById('quoteDate');
      if (dateEl) dateEl.value = Utils.todayISO();
      const termsEl = document.getElementById('termsText');
      if (termsEl) termsEl.value = DEFAULT_TERMS || '';
      const poN = document.getElementById('poNumber');
      if (poN) poN.value = '';
      const poD = document.getElementById('poDate');
      if (poD) poD.value = '';
      addItem();
      const qnEl = document.getElementById('quoteNo');
      if (qnEl) delete qnEl.dataset.userEdited;
      if (typeof window.setDocType === 'function') {
        window.setDocType(keepType, { silent: true });
      } else if (typeof window.syncDocTypeUI === 'function') {
        window.syncDocTypeUI(true);
      }
      recalcAll();
      autosave();
    }
    window.clearForm = clearForm;

    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!confirm('Start a new Quotation / Invoice? Current form will be cleared.')) return;
      clearForm(false);
    });

    document.getElementById('genPdfBtn').addEventListener('click', async () => {
      const errors = validate();
      if (errors.length) { showErrors(errors); return; }
      hideErrors();
      const btn = document.getElementById('genPdfBtn');
      btn.disabled = true;
      try {
        const docType = (document.getElementById('docType') || {}).value || 'quotation';
        const qn = document.getElementById('quoteNo');
        if (typeof SerialSync === 'undefined' || !SerialSync.isConfigured()) {
          toast('Cloud sync off — serial-config.js mein URL/KEY set karo (dono phones pe same)');
          return;
        }
        const preferred = (qn && qn.value) ? String(qn.value).trim() : '';
        if (docType === 'invoice') {
          const reserved = await SerialSync.reserveInvoiceNext(preferred);
          if (reserved.source !== 'cloud' || !reserved.quoteNo) {
            toast('Invoice serial cloud se nahi mila: ' + (reserved.error || 'retry'));
            return;
          }
          if (qn) {
            qn.value = reserved.quoteNo;
            delete qn.dataset.userEdited;
          }
          toast('Invoice # ' + reserved.quoteNo);
        } else {
          const reserved = await SerialSync.reserveNext(preferred);
          if (reserved.source !== 'cloud' || !reserved.quoteNo) {
            toast('Quotation serial cloud se nahi mila: ' + (reserved.error || 'retry'));
            return;
          }
          if (qn) {
            qn.value = reserved.quoteNo;
            delete qn.dataset.userEdited;
          }
          toast('Quotation # ' + reserved.quoteNo);
        }
        const data = collectData();
        data.meta.docType = docType;
        if (docType === 'invoice') {
          data.terms = { deliveryTime: '', paymentTerms: '', remarks: '', termsText: [] };
          localStorage.setItem('qgen.lastInvoiceNo.v1', data.meta.quoteNo);
        } else {
          Storage.setLastQuoteNo(data.meta.quoteNo);
        }
        if (typeof SerialSync !== 'undefined') await SerialSync.saveHistory(data);
        else Storage.saveToHistory(data);
        await refreshHistoryList();
        await PdfExport.generate(data);
        // Auto-clear form after successful PDF (keep same doc type)
        if (typeof window.clearForm === 'function') {
          window.clearForm(true);
          toast('PDF ready — form cleared for next entry');
        }
      } finally {
        btn.disabled = false;
      }
    });

    const previewBtn = document.getElementById('previewPdfBtn');
    if (previewBtn) {
      previewBtn.addEventListener('click', async () => {
        const errors = validate();
        if (errors.length) { showErrors(errors); return; }
        hideErrors();
        previewBtn.disabled = true;
        try {
          if (typeof PdfExport === 'undefined' || !PdfExport.preview) {
            toast('Preview not loaded — hard refresh / cache clear karo');
            return;
          }
          const data = collectData();
          data.meta.docType = (document.getElementById('docType') || {}).value || 'quotation';
          if (data.meta.docType === 'invoice') {
            data.terms = { deliveryTime: '', paymentTerms: '', remarks: '', termsText: [] };
          }
          // Ensure date present in data
          if (!data.meta.date) {
            data.meta.date = Utils.todayISO();
            const de = document.getElementById('quoteDate');
            if (de) de.value = data.meta.date;
          }
          toast('Preview ban raha hai…');
          await PdfExport.preview(data);
        } catch (e) {
          console.error(e);
          toast('Preview failed: ' + (e.message || e));
        } finally {
          previewBtn.disabled = false;
        }
      });
    }



    // Gemini key — localStorage only (never commit to GitHub)
    (function wireGeminiKey() {
      const input = document.getElementById('geminiKeyInput');
      const saveBtn = document.getElementById('geminiKeySaveBtn');
      const clearBtn = document.getElementById('geminiKeyClearBtn');
      const status = document.getElementById('geminiStatus');
      function refreshGeminiStatus() {
        let on = false;
        try { on = !!(localStorage.getItem('kmf_gemini_key') || '').trim(); } catch (e) {}
        if (status) {
          status.textContent = on ? 'AI: On' : 'AI: Off';
          status.style.color = on ? '#059669' : '';
        }
      }
      if (!input) return;
      try {
        const existing = localStorage.getItem('kmf_gemini_key') || '';
        if (existing) input.placeholder = 'Key saved';
      } catch (e) {}
      refreshGeminiStatus();
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const v = (input.value || '').trim();
          if (v.length < 10) { toast('Valid Gemini key paste karo'); return; }
          try {
            localStorage.setItem('kmf_gemini_key', v);
            input.value = '';
            input.placeholder = 'Key saved';
            refreshGeminiStatus();
            toast('AI key saved');
          } catch (e) {
            toast('Save fail');
          }
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          try { localStorage.removeItem('kmf_gemini_key'); } catch (e) {}
          input.value = '';
          input.placeholder = 'New key paste karo';
          refreshGeminiStatus();
          toast('AI key cleared');
        });
      }
      const testBtn = document.getElementById('geminiKeyTestBtn');
      if (testBtn) {
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true;
          try {
            // save typed key first if present
            const v = (input.value || '').trim();
            if (v.length > 10) localStorage.setItem('kmf_gemini_key', v);
            if (typeof PoImport === 'undefined' || !PoImport.testGeminiKey) {
              toast('po-import.js update karo');
              return;
            }
            toast('AI key test…');
            const tr = await PoImport.testGeminiKey();
            refreshGeminiStatus();
            const m = (tr && tr.model) ? tr.model : '';
            toast('AI key OK' + (m ? (' · ' + m) : ''));
          } catch (e) {
            console.error(e);
            toast('AI key fail: ' + (e.message || e));
            refreshGeminiStatus();
          } finally {
            testBtn.disabled = false;
          }
        });
      }
    })();

    // ---- PO Upload auto-fill (no Bill To / customer) ----
    const poUploadBtn = document.getElementById('poUploadBtn');
    const poFileInput = document.getElementById('poFileInput');
    if (poUploadBtn && poFileInput) {
      poUploadBtn.addEventListener('click', () => poFileInput.click());
      poFileInput.addEventListener('change', async () => {
        const file = poFileInput.files && poFileInput.files[0];
        poFileInput.value = '';
        if (!file) return;
        if (typeof PoImport === 'undefined') {
          toast('PO import module missing — po-import.js add karo');
          return;
        }
        poUploadBtn.disabled = true;
        poUploadBtn.textContent = 'Reading…';
        const hint = document.getElementById('poUploadHint');
        try {
          toast('PO padh rahe hain…');
          const parsed = await PoImport.importFile(file);
          // PO No + Date
          if (parsed.poNumber) {
            const el = document.getElementById('poNumber');
            if (el) el.value = parsed.poNumber;
          }
          if (parsed.poDate) {
            const el = document.getElementById('poDate');
            if (el) el.value = parsed.poDate;
          }
          // Items — replace rows (customer untouched)
          if (parsed.items && parsed.items.length) {
            itemsWrap.innerHTML = '';
            parsed.items.forEach((it) => {
              addItem({
                desc: it.desc,
                hsn: it.hsn || '',
                unit: it.unit || 'AU',
                qty: it.qty,
                rate: it.rate,
                disc: it.disc || 0,
                gst: it.gst != null ? it.gst : 18,
              });
            });
            renumberRows();
            recalcAll();
            // Subject = short form of first item description (e.g. Tablet supply)
            const subEl = document.getElementById('subject');
            if (subEl) {
              const shortSub = parsed.subject
                || (typeof PoImport !== 'undefined' && PoImport.shortSubject
                      ? PoImport.shortSubject(parsed.items[0].desc)
                      : '');
              if (shortSub) subEl.value = shortSub;
            }
          }
          autosave();
          const n = (parsed.items || []).length;
          let msg = (parsed.source === 'ai' ? 'Imported' : 'Imported (basic)') + ': '
            + (parsed.poNumber || '—');
          if (n) {
            const r0 = parsed.items[0];
            msg += ' · ' + n + ' item(s)';
            if (r0 && r0.rate) msg += ' · ₹' + r0.rate;
          } else {
            msg += ' · no items';
          }
          if (parsed.aiError) msg += ' · AI: ' + String(parsed.aiError).slice(0, 60);
          toast(msg);
          if (hint) hint.textContent = msg;
        } catch (e) {
          console.error(e);
          toast('PO import fail: ' + (e.message || e));
          if (hint) hint.textContent = 'Import fail — clear PDF try karo. Customer / Bill To auto nahi bharte.';
        } finally {
          poUploadBtn.disabled = false;
          poUploadBtn.textContent = '📄 Upload PO';
        }
      });
    }

    const previewClose = document.getElementById('previewCloseBtn');
    const previewModal = document.getElementById('previewModal');
    if (previewClose && previewModal) {
      previewClose.addEventListener('click', () => {
        previewModal.classList.add('hidden');
        const frame = document.getElementById('previewFrame');
        if (frame) frame.src = '';
      });
      previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
          previewModal.classList.add('hidden');
          const frame = document.getElementById('previewFrame');
          if (frame) frame.src = '';
        }
      });
    }


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

  async function updateCloudStatus() {
    const el = document.getElementById('cloudStatus');
    if (!el || typeof SerialSync === 'undefined') return;
    if (!SerialSync.isConfigured()) {
      el.className = 'cloud-status cloud-status--err';
      el.textContent = '⚠ Cloud OFF — serial-config.js mein SUPABASE_URL + ANON_KEY set karo (dono phones same file).';
      el.classList.remove('hidden');
      return;
    }
    const res = await SerialSync.testConnection();
    if (res.ok) {
      el.className = 'cloud-status cloud-status--ok';
      el.textContent = '☁ Cloud connected — serial, customers, history dono phones pe sync.';
      el.classList.remove('hidden');
      setTimeout(() => { el.classList.add('hidden'); }, 5000);
    } else {
      el.className = 'cloud-status cloud-status--err';
      el.textContent = '⚠ Cloud error: ' + res.message;
      el.classList.remove('hidden');
    }
  }

  function initApp() {
    if (!Storage.isAvailable()) {
      const w = document.getElementById('storageWarning');
      if (w) w.classList.remove('hidden');
    }
    wireStaticControls();
    wireCustomerPicker();
    loadDraftIntoForm();
    ensureQuoteDate();
    refreshHistoryList();
    recalcAll();
    updateCloudStatus();

    async function softRefreshCloud() {
      try {
        await refreshCustomerPicker();
        await refreshHistoryList();
        // refresh serial preview if user has not typed
        const qn = document.getElementById('quoteNo');
        const dt = (document.getElementById('docType') || {}).value || 'quotation';
        if (qn && !qn.dataset.userEdited && typeof SerialSync !== 'undefined' && SerialSync.isConfigured()) {
          if (dt === 'invoice') {
            SerialSync.peekInvoiceNext().then((no) => { if (!qn.dataset.userEdited) qn.value = no; }).catch(() => {});
          } else {
            SerialSync.peekNext().then((no) => { if (!qn.dataset.userEdited) qn.value = no; }).catch(() => {});
          }
        }
      } catch (e) { /* ignore */ }
    }
    setInterval(softRefreshCloud, 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        softRefreshCloud();
        updateCloudStatus();
      }
    });
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
