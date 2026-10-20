const crypto = require('crypto');
class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function charge(quantityMl, ratePaise) {
  if (![quantityMl, ratePaise].every(n => Number.isSafeInteger(n) && n >= 0)) throw new AppError(400, 'INVALID_AMOUNT', 'Amounts must be non-negative integers.');
  const total = (BigInt(quantityMl) * BigInt(ratePaise) + 500n) / 1000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount is too large.');
  return Number(total);
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function eligible(customer, date) { return customer.status === 'active' && date >= customer.startDate && (!customer.endDate || date <= customer.endDate); }
function csvCell(value) { const s = String(value ?? ''); return '"' + (/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'; }
module.exports = { AppError, charge, today, fingerprint, eligible, csvCell };
