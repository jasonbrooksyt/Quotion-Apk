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

const BANK = {
  name: 'Axis Bank',
  accountNo: '924020000607385',
  ifsc: 'UTIB0002518',
  upi: 'kanakmechanical@ybl',
};

const DEFAULT_TERMS = [
  'GST rate may be changed in final tax invoice as per type of Goods or service.',
  'Work Completion: - 30 days from date of receipts of your purchase order.',
  'Payment condition: - 100% within 30 days after delivery.',
  'Validity: - the offer is valid for period of 10 days from the date of the offer.',
].join('\n');

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

  function wrapText(text, maxCharsPerLine) {
    if (!text) return [];
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    words.forEach((word) => {
      const candidate = current ? current + ' ' + word : word;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
    return lines;
  }


  function financialYearLabel(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = d.getMonth(); // 0=Jan
    const start = m >= 3 ? y : y - 1; // FY starts April
    return String(start).slice(-2) + '-' + String(start + 1).slice(-2);
  }

  function nextInvoiceNumber(lastNumber) {
    const fy = financialYearLabel(new Date());
    const prefix = 'GST/' + fy + '/';
    if (!lastNumber) return prefix + '0001';
    const m = String(lastNumber).match(/GST\/(\d{2}-\d{2})\/(\d+)/);
    if (!m || m[1] !== fy) return prefix + '0001';
    const next = String(Number(m[2]) + 1).padStart(4, '0');
    return prefix + next;
  }

  function buildUpiUri(amount, invoiceNo) {
    const pa = encodeURIComponent(BANK.upi || '');
    const pn = encodeURIComponent(COMPANY.name || 'KMF');
    const am = round2(amount || 0).toFixed(2);
    const tn = encodeURIComponent(invoiceNo ? ('Invoice ' + invoiceNo) : 'Payment');
    return 'upi://pay?pa=' + pa + '&pn=' + pn + '&am=' + am + '&cu=INR&tn=' + tn;
  }

  return { round2, fmtMoney, todayISO, formatDateDMY, addDaysISO, amountInWords, nextQuotationNumber, nextInvoiceNumber, financialYearLabel, buildUpiUri, escapeHtml, wrapText };

})();
