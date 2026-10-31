const crypto = require('crypto');
const { URLSearchParams } = require('node:url');
const QRCode = require('qrcode');
const { Bill, Milkman, PaymentIntent } = require('./models');
const { AppError } = require('./domain');
const { writeOnce } = require('./services');

const UPI_ID = /^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const DEFAULT_INTENT_LIFETIME_MS = 15 * 60 * 1000;

function inrAmount(amountPaise) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Payment amount must be a positive integer number of paise.');
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`;
}

function paymentUri({ payeeUpiId, payeeName, amountPaise, internalReference }) {
  const params = new URLSearchParams({ pa: payeeUpiId, pn: payeeName, am: inrAmount(amountPaise), cu: 'INR', tn: `GauAmrut ${internalReference}` });
  return `upi://pay?${params.toString()}`;
}

async function createPaymentIntent(req) {
  if (req.user.role !== 'customer') throw new AppError(403, 'FORBIDDEN', 'Payment initiation is available only to customer accounts.');
  return writeOnce(req, async session => {
    const bill = await Bill.findOne({ _id: req.body.bill_id, milkman_id: req.tenant, customer_id: req.user.customer_id }).session(session);
    if (!bill) throw new AppError(404, 'NOT_FOUND', 'Bill was not found.');
    if (bill.closingPaise <= 0) throw new AppError(409, 'NO_OUTSTANDING_BALANCE', 'This bill has no outstanding balance.');
    const amountPaise = req.body.amountPaise ?? bill.closingPaise;
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > bill.closingPaise) throw new AppError(409, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must not exceed the bill outstanding balance.');

    const dairy = await Milkman.findOne({ _id: req.tenant }).session(session);
    const payeeUpiId = String(dairy?.upiId || '').trim();
    if (!UPI_ID.test(payeeUpiId)) throw new AppError(409, 'UPI_NOT_CONFIGURED', 'Your dairy has not configured a valid UPI ID.');
    const payeeName = String(dairy.businessName || dairy.name || 'Dairy').trim().slice(0, 100);
    const internalReference = `GAUPI-${crypto.randomUUID()}`;
    const [intent] = await PaymentIntent.create([{
      milkman_id: req.tenant, customer_id: req.user.customer_id, bill_id: bill._id, amountPaise,
      payeeUpiId, payeeName, internalReference, status: 'active',
      expiresAt: new Date(Date.now() + DEFAULT_INTENT_LIFETIME_MS)
    }], { session });
    return intent.toObject();
  });
}

async function presentPaymentIntent(intent) {
  const upiUri = paymentUri(intent);
  const qrDataUrl = await QRCode.toDataURL(upiUri, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  return {
    id: intent._id, bill_id: intent.bill_id, amountPaise: intent.amountPaise, currency: intent.currency,
    payee: { upiId: intent.payeeUpiId, name: intent.payeeName },
    internalReference: intent.internalReference, status: intent.status, createdAt: intent.createdAt, expiresAt: intent.expiresAt,
    upiUri, qrDataUrl, settlementStatus: 'unverified'
  };
}

module.exports = { createPaymentIntent, presentPaymentIntent, paymentUri, inrAmount, UPI_ID, DEFAULT_INTENT_LIFETIME_MS };
