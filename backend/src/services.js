const mongoose = require('mongoose');
const crypto = require('crypto');
const { Customer, Record, Bill, Payment, Idempotency, Audit } = require('./models');
const { AppError, charge, fingerprint, eligible, today } = require('./domain');
async function writeOnce(req, operation) {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[\w-]{8,128}$/.test(key)) throw new AppError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required.');
  const owner_scope = String(req.user._id);
  const hash = fingerprint({ path: req.originalUrl, body: req.body });
  function replay(existing) {
    if (existing.hash !== hash) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for different content.');
    return existing.response;
  }
  const existing = await Idempotency.findOne({ owner_scope, key });
  if (existing) return replay(existing);
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const prior = await Idempotency.findOne({ owner_scope, key }).session(session);
      if (prior) { response = replay(prior); return; }
      // Insert first: concurrent uses of this key contend before ledger work.
      const [entry] = await Idempotency.create([{ owner_scope, key, hash }], { session });
      response = await operation(session);
      entry.response = response; await entry.save({ session });
      await Audit.create([{ milkman_id: req.tenant, actor: req.user._id, action: req.method + ' ' + req.path, target: key, requestId: req.requestId }], { session });
    });
    return response;
  } catch (error) {
    if (error.code === 11000) {
      const saved = await Idempotency.findOne({ owner_scope, key });
      if (saved) return replay(saved);
      throw new AppError(409, 'DUPLICATE_RECORD', 'This delivery, bill, or payment reference already exists. Refresh and review the existing record.');
    }
    throw error;
  } finally { await session.endSession(); }
}
async function enterDeliveries(req) {
  return writeOnce(req, async session => {
    const result = [];
    for (const item of req.body.items) {
      const customer = await Customer.findOne({ _id: item.customer_id, milkman_id: req.tenant }).session(session);
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
      if (!eligible(customer, item.date) || item.date > today()) throw new AppError(409, 'INELIGIBLE_DELIVERY', 'Customer is not eligible on this service date, or the date is in the future.');
      if (await Bill.exists({ milkman_id: req.tenant, customer_id: customer._id, month: { $gte: item.date.slice(0, 7) } }).session(session)) throw new AppError(409, 'PERIOD_CLOSED', 'This period has been billed. Corrections require a future adjustment workflow.');
      // Touch the customer to serialize billing, lifecycle updates and delivery writes.
      await Customer.updateOne({ _id: customer._id }, { $inc: { __v: 1 } }, { session });
      const ratePaise = item.type === 'cow' ? customer.cowRatePaise : customer.buffaloRatePaise;
      const existing = await Record.findOne({ milkman_id: req.tenant, customer_id: customer._id, date: item.date, shift: item.shift, type: item.type }).session(session);
      if (existing) {
        if (!existing.deleted) throw new AppError(409, 'DUPLICATE_RECORD', 'This delivery record already exists.');
        existing.quantityMl = item.quantityMl;
        existing.ratePaise = ratePaise;
        existing.totalPaise = charge(item.quantityMl, ratePaise);
        existing.deleted = false;
        await existing.save({ session });
        result.push(existing.toObject());
      } else {
        const [record] = await Record.create([{ ...item, milkman_id: req.tenant, ratePaise, totalPaise: charge(item.quantityMl, ratePaise) }], { session });
        result.push(record.toObject());
      }
    }
    return result;
  });
}
async function generateBill(req) {
  return writeOnce(req, async session => {
    const { customer_id, month } = req.body;
    if (month >= today().slice(0, 7)) throw new AppError(409, 'MONTH_OPEN', 'Bills can be finalized only after the month ends.');
    const customer = await Customer.findOne({ _id: customer_id, milkman_id: req.tenant }).session(session);
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
    const existing = await Bill.findOne({ milkman_id: req.tenant, customer_id, month }).session(session);
    if (existing) return existing.toObject();
    await Customer.updateOne({ _id: customer._id }, { $inc: { __v: 1 } }, { session });
    if (await Bill.exists({ milkman_id: req.tenant, customer_id, month: { $gt: month } }).session(session)) throw new AppError(409, 'BILL_ORDER', 'Bills must be generated in chronological order.');
    const previous = await Bill.findOne({ milkman_id: req.tenant, customer_id, month: { $lt: month } }).sort({ month: -1 }).session(session);
    const unbilledEarlier = await Record.exists({ milkman_id: req.tenant, customer_id, deleted: false, date: { $lt: month + '-01', ...(previous ? { $gt: previous.month + '-31' } : {}) } }).session(session);
    if (unbilledEarlier) throw new AppError(409, 'EARLIER_UNBILLED_RECORDS', 'Generate the earlier month’s bill first.');
    const openingPaise = previous ? previous.closingPaise : (customer.openingBalancePaise || 0);
    const records = await Record.find({ milkman_id: req.tenant, customer_id, deleted: false, date: { $gte: month + '-01', $lte: month + '-31' } }).session(session);
    const chargesPaise = records.reduce((sum, r) => sum + r.totalPaise, 0);
    const closingPaise = openingPaise + chargesPaise;
    const [bill] = await Bill.create([{ milkman_id: req.tenant, customer_id, month, openingPaise, chargesPaise, paidPaise: 0, closingPaise }], { session });
    return bill.toObject();
  });
}
async function recordPayment(req) {
  return writeOnce(req, async session => {
    const { bill_id, customer_id, amountPaise, method, reference } = req.body;
    let targetBill;
    if (bill_id) {
      targetBill = await Bill.findOne({ _id: bill_id, milkman_id: req.tenant }).session(session);
      if (!targetBill) throw new AppError(409, 'INVALID_PAYMENT', 'Bill was not found or the payment exceeds its outstanding balance.');
      if (targetBill.closingPaise < amountPaise) {
        throw new AppError(409, 'INVALID_PAYMENT', 'Payment exceeds outstanding balance of the bill.');
      }
    } else if (customer_id) {
      targetBill = await Bill.findOne({ customer_id, milkman_id: req.tenant, closingPaise: { $gt: 0 } }).sort({ month: 1 }).session(session);
      if (!targetBill) throw new AppError(409, 'NO_OUTSTANDING_BILLS', 'Customer has no outstanding bills to pay.');
      if (targetBill.closingPaise < amountPaise) {
        throw new AppError(409, 'INVALID_PAYMENT', 'Payment exceeds outstanding balance of the oldest bill.');
      }
    } else {
      throw new AppError(400, 'BILL_OR_CUSTOMER_REQUIRED', 'Either bill_id or customer_id is required.');
    }

    const previousBalance = targetBill.closingPaise;
    targetBill.paidPaise += amountPaise;
    targetBill.closingPaise -= amountPaise;
    await targetBill.save({ session });

    const receipt = 'GA-' + crypto.randomUUID();
    const [payment] = await Payment.create([{
      milkman_id: req.tenant,
      customer_id: targetBill.customer_id,
      bill_id: targetBill._id,
      amountPaise,
      method,
      ...(reference ? { reference } : {}),
      receipt
    }], { session });

    const paymentObj = payment.toObject();
    paymentObj.balanceBeforePaise = previousBalance;
    paymentObj.balanceAfterPaise = targetBill.closingPaise;
    paymentObj.billMonth = targetBill.month;
    return paymentObj;
  });
}
module.exports = { writeOnce, enterDeliveries, generateBill, recordPayment };
