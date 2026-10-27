const mongoose = require('mongoose');
const crypto = require('crypto');
const { Customer, Record, Bill, Payment, Adjustment, Idempotency, Audit } = require('./models');
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
      const recordMonth = item.date.slice(0, 7);
      // Closed months stay billed-only; the current month keeps accepting entries
      // even after a mid-month bill (the bill refreshes on regeneration).
      if (recordMonth < today().slice(0, 7) && await Bill.exists({ milkman_id: req.tenant, customer_id: customer._id, month: { $gte: recordMonth } }).session(session)) throw new AppError(409, 'PERIOD_CLOSED', 'This period has been billed. Corrections require a future adjustment workflow.');
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
    if (month > today().slice(0, 7)) throw new AppError(409, 'FUTURE_MONTH', 'Bills cannot be generated for a month that has not started yet.');
    const customer = await Customer.findOne({ _id: customer_id, milkman_id: req.tenant }).session(session);
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
    const existing = await Bill.findOne({ milkman_id: req.tenant, customer_id, month }).session(session);
    if (existing) {
      // A bill always mirrors the ledger: regenerate to pick up new or corrected
      // entries and any carry-forward changes, keeping payments already applied.
      await refreshBilledMonths(session, { milkmanId: req.tenant, customerId: customer_id, fromMonth: month, fallbackOpening: customer.openingBalancePaise || 0 });
      const refreshed = await Bill.findOne({ _id: existing._id }).session(session);
      return refreshed.toObject();
    }
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
// Recomputes the bill for `fromMonth` (and cascades opening/closing into later
// months) so bills stay in step with deliveries, payments and carry-forward.
async function refreshBilledMonths(session, { milkmanId, customerId, fromMonth, fallbackOpening = 0 }) {
  const bills = await Bill.find({ milkman_id: milkmanId, customer_id: customerId, month: { $gte: fromMonth } }).sort({ month: 1 }).session(session);
  if (!bills.length) return null;
  const prior = await Bill.findOne({ milkman_id: milkmanId, customer_id: customerId, month: { $lt: fromMonth } }).sort({ month: -1 }).session(session);
  let carryPaise = prior ? prior.closingPaise : fallbackOpening;
  // Waivers, credits and debits mutate closingPaise directly; preserve their net
  // effect so refreshing a bill never erases a manual ledger adjustment.
  const adjustments = await Adjustment.find({ milkman_id: milkmanId, customer_id: customerId, status: 'applied', bill_id: { $in: bills.map(b => b._id) } }).session(session);
  const adjustedPaise = new Map();
  for (const adj of adjustments) {
    const delta = adj.type === 'credit' || adj.type === 'waiver' ? -adj.amountPaise : adj.amountPaise;
    adjustedPaise.set(String(adj.bill_id), (adjustedPaise.get(String(adj.bill_id)) || 0) + delta);
  }
  let changed = false;
  for (const bill of bills) {
    let chargesPaise = bill.chargesPaise;
    if (bill.month === fromMonth) {
      const records = await Record.find({ milkman_id: milkmanId, customer_id: customerId, deleted: false, date: { $gte: bill.month + '-01', $lte: bill.month + '-31' } }).session(session);
      chargesPaise = records.reduce((sum, r) => sum + r.totalPaise, 0);
    }
    const closingPaise = carryPaise + chargesPaise - bill.paidPaise + (adjustedPaise.get(String(bill._id)) || 0);
    if (bill.openingPaise !== carryPaise || bill.chargesPaise !== chargesPaise || bill.closingPaise !== closingPaise) {
      bill.openingPaise = carryPaise;
      bill.chargesPaise = chargesPaise;
      bill.closingPaise = closingPaise;
      await bill.save({ session });
      changed = true;
    }
    carryPaise = closingPaise;
  }
  return { bill: bills[0], changed };
}
// Till-date outstanding per customer: the latest bill's closing balance (the
// whole carry chain in one number) plus every delivery month not billed yet.
async function outstandingByCustomer(match, customerFilter) {
  const [latestBills, chargesByMonth, ledgers] = await Promise.all([
    Bill.aggregate([{ $match: match }, { $sort: { month: 1 } }, { $group: { _id: '$customer_id', closingPaise: { $last: '$closingPaise' }, lastMonth: { $last: '$month' } } }]),
    Record.aggregate([{ $match: { ...match, deleted: false } }, { $group: { _id: { customer: '$customer_id', month: { $substrCP: ['$date', 0, 7] } }, totalPaise: { $sum: '$totalPaise' } } }]),
    Customer.find(customerFilter).select('openingBalancePaise').lean()
  ]);
  const billByCustomer = new Map(latestBills.map(b => [String(b._id), b]));
  const ledgerByCustomer = new Map(ledgers.map(c => [String(c._id), c]));
  const outstanding = new Map();
  for (const [cid, billed] of billByCustomer) outstanding.set(cid, billed.closingPaise);
  for (const [cid, ledger] of ledgerByCustomer) if (!outstanding.has(cid)) outstanding.set(cid, ledger.openingBalancePaise || 0);
  for (const row of chargesByMonth) {
    const cid = String(row._id.customer), billed = billByCustomer.get(cid);
    if (!billed || row._id.month > billed.lastMonth) outstanding.set(cid, (outstanding.get(cid) || 0) + row.totalPaise);
  }
  return outstanding;
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
// A "till-date statement" for a customer for any month up to the current one.
// If a finalized bill exists for that month it is returned verbatim (provisional:
// false). Otherwise a provisional statement is composed on the fly so the current
// month is always viewable/downloadable before the month closes:
//   opening = latest bill's closing (or the customer's opening balance) rolled
//             back by any payments already applied to that bill this month,
//   charges = deliveries recorded this month up to today,
//   paid    = payments applied to the latest bill during this month,
//   closing = opening + charges - paid.
async function billStatement({ tenant, customerId, month }) {
  const currentMonth = today().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || month > currentMonth) {
    throw new AppError(409, 'FUTURE_MONTH', 'Statements cannot be prepared for a month that has not started yet.');
  }

  const existing = await Bill.findOne({ milkman_id: tenant, customer_id: customerId, month }).lean();
  if (existing) return { ...existing, provisional: false };

  const customer = await Customer.findOne({ _id: customerId, milkman_id: tenant }).lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');

  const previous = await Bill.findOne({ milkman_id: tenant, customer_id: customerId, month: { $lt: month } }).sort({ month: -1 }).lean();
  const monthStart = new Date(month + '-01T00:00:00+05:30');
  const monthEnd = new Date(month + '-31T23:59:59.999+05:30');

  // Payments recorded this month that were applied to the latest bill (or, when
  // there is no earlier bill, to any bill for this customer).
  const paidFilter = {
    milkman_id: tenant,
    customer_id: customerId,
    deleted: false,
    reversed: false,
    createdAt: { $gte: monthStart, $lte: monthEnd },
    ...(previous ? { bill_id: previous._id } : {})
  };
  const [records, payments] = await Promise.all([
    Record.find({ milkman_id: tenant, customer_id: customerId, deleted: false, date: { $gte: month + '-01', $lte: month + '-31' } }).sort({ date: 1 }).lean(),
    Payment.find(paidFilter).sort({ createdAt: 1 }).lean()
  ]);

  const chargesPaise = records.reduce((sum, r) => sum + r.totalPaise, 0);
  const paidThisMonth = payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const priorClosing = previous ? previous.closingPaise : (customer.openingBalancePaise || 0);
  // previous.closingPaise already nets off payments applied to it, so roll those
  // back to recover the balance as it stood at the start of the month.
  const openingPaise = priorClosing + paidThisMonth;
  const closingPaise = openingPaise + chargesPaise - paidThisMonth;

  return {
    _id: null,
    milkman_id: tenant,
    customer_id: customerId,
    month,
    openingPaise,
    chargesPaise,
    paidPaise: paidThisMonth,
    closingPaise,
    currency: 'INR',
    provisional: true
  };
}
module.exports = { writeOnce, enterDeliveries, generateBill, recordPayment, refreshBilledMonths, outstandingByCustomer, billStatement };
