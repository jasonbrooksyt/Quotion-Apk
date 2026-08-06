/* utils.js — shared helper functions, no dependencies */

// Fixed company header — same on every quotation. Edit here if the company's
// own details ever change; nothing else in the app needs to be touched.
const COMPANY = {
  name: 'KANAK MECHANICALS & FABRICATION WORKS',
  gstin: '23KKDPK4067A1ZG',
  addressLine: 'Building No./Flat No.: R2-894, Kurawar, Dist.- Rajgarh (M.P.), Pincode 465667',
  phone: '7509179102',
  email: 'kanakmechanical.fab@gmail.com',
};

const Utils = (function () {

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function fmtMoney(n) {
    const num = round2(n || 0);
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function todayISO() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDateDMY(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }

  function addDaysISO(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + Number(days || 0));
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Indian numbering system number-to-words (Rupees + Paise)
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10), o = n % 10;
    return TENS[t] + (o ? ' ' + ONES[o] : '');
  }

  function threeDigits(n) {
    const h = Math.floor(n / 100), r = n % 100;
    let s = '';
    if (h) s += ONES[h] + ' Hundred';
    if (r) s += (h ? ' ' : '') + twoDigits(r);
    return s;
  }

  function numberToWordsIndian(num) {
    num = Math.floor(num);
    if (num === 0) return 'Zero';
    const crore = Math.floor(num / 10000000); num %= 10000000;
    const lakh = Math.floor(num / 100000); num %= 100000;
    const thousand = Math.floor(num / 1000); num %= 1000;
    const rest = num;
    let parts = [];
    if (crore) parts.push(threeDigits(crore) + ' Crore');
    if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
    if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
    if (rest) parts.push(threeDigits(rest));
    return parts.join(' ');
  }

  function amountInWords(amount, currencyLabel) {
    amount = round2(amount);
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let words = numberToWordsIndian(rupees) + ' ' + (currencyLabel || 'Rupees') + ' Only';
    if (paise > 0) {
      words = numberToWordsIndian(rupees) + ' ' + (currencyLabel || 'Rupees') + ' and ' + numberToWordsIndian(paise) + ' Paise Only';
    }
    return words;
  }

  function nextQuotationNumber(lastNumber) {
    const year = new Date().getFullYear();
    if (!lastNumber) return `QT-${year}-0001`;
    const m = lastNumber.match(/QT-(\d{4})-(\d+)/);
    if (!m) return `QT-${year}-0001`;
    const [, lastYear, seq] = m;
    if (Number(lastYear) !== year) return `QT-${year}-0001`;
    const next = String(Number(seq) + 1).padStart(4, '0');
    return `QT-${year}-${next}`;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  return { round2, fmtMoney, todayISO, formatDateDMY, addDaysISO, amountInWords, nextQuotationNumber, escapeHtml };
})();
