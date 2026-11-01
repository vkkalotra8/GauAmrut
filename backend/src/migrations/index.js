const crypto = require('crypto');

const ensurePaymentsNamespace = require('./000-ensure-payments-namespace');
const paymentReferenceScope = require('./001-payment-reference-scope');

const migrations = [
  ensurePaymentsNamespace,
  paymentReferenceScope,
].map(migration => ({
  ...migration,
  checksum: crypto
    .createHash('sha256')
    .update(migration.up.toString())
    .digest('hex'),
}));

module.exports = { migrations };