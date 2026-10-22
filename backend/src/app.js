const { adminRoutes } = require('./admin');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { authRoutes } = require('./auth');
const { User, Customer, Record, Bill, Payment, Adjustment, Milkman, PaymentRequest, Product, Order, Dispute, DeliveryAdjustment, Notification } = require('./models');
const { auth, vendor, validate, wrap, scope } = require('./middleware');
const { AppError, today, csvCell, charge } = require('./domain');
const schemas = require('./validation');
const { enterDeliveries, generateBill, recordPayment } = require('./services');
const { accountsRoutes, change } = require('./accounts');
const { runMonthlyBillingScheduler } = require('./billing-scheduler');
const { createNotification, getNotifications, markRead, markAllRead } = require('./notifications');
const { generateBillPdf } = require('./pdf');
const { platformSettings } = require('./settings');
function createApp(redis) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.set('X-Request-Id', req.requestId); next(); });
  app.use(helmet());
  const allowed = (process.env.CORS_ORIGINS || 'http://127.0.0.1:5173').split(',');
  // Development convenience: outside production, also accept dev-server origins
  // whose host is loopback or a private LAN address (LAN IPs change with DHCP, so
  // listing every device address in CORS_ORIGINS is impractical). Public web
  // origins (normal websites) never match this pattern.
  const privateOrigin = origin => process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127(\.\d{1,3}){3}|192\.168(\.\d{1,3}){3}|10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|\[::1\])(:\d+)?$/i.test(origin);
  app.use(cors({ origin: (origin, cb) => cb(origin && !allowed.includes(origin) && !privateOrigin(origin) ? new AppError(403, 'ORIGIN_DENIED', 'Origin is not allowed.') : null, true), exposedHeaders: ['X-Request-Id'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] }));
  app.use(express.json({ limit: '100kb' }));
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, ...(redis ? { store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }) } : {}), message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in 15 minutes.' } } });
  app.get('/api/health', (_req, res) => { const ready = mongoose.connection.readyState === 1 && (!redis || redis.isReady); res.status(ready ? 200 : 503).json({ success: ready, data: { status: ready ? 'ready' : 'unavailable', database: mongoose.connection.readyState === 1, redis: redis ? redis.isReady : 'not configured' } }); });
  // Public, unauthenticated read of the platform settings every signed-in
  // client consumes (announcement banner, support contact, billing defaults,
  // sign-up availability). Contains no tenant or account data.
  app.get('/api/platform/settings', wrap(async (_req, res) => res.json({ success: true, data: await platformSettings() })));
  app.use('/api/auth', authRoutes(limiter));
  const api = express.Router();
  api.use(auth);
  api.use('/admin', adminRoutes());
  api.use((req, _res, next) => req.user.role === 'admin' ? next(new AppError(403, 'ADMIN_ROUTE_REQUIRED', 'Use the admin console to access platform data.')) : next());
  api.use(accountsRoutes());
  const ok = (res, data, meta) => res.json({ success: true, data, ...(meta ? { meta } : {}) });
  const page = req => {
    const p = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
    if (!Number.isInteger(p) || p < 1 || p > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_PAGINATION', 'Page and limit must be positive integers; limit cannot exceed 100.');
    return { page: p, limit, skip: (p - 1) * limit };
  };
  function validDate(value) { if (schemas.date.validate(value).error) throw new AppError(400, 'INVALID_DATE', 'Use a valid YYYY-MM-DD date.'); return value; }
  api.get('/dashboard', wrap(async (req, res) => {
    const date = today(), match = scope(req);
    const [customerCount, activeCustomers, daily, monthly, debt, collected, recent, business] = await Promise.all([
      Customer.countDocuments({ milkman_id: req.tenant, ...(req.user.role === 'customer' ? { _id: req.user.customer_id } : {}) }),
      Customer.countDocuments({ milkman_id: req.tenant, status: 'active', ...(req.user.role === 'customer' ? { _id: req.user.customer_id } : {}) }),
      Record.aggregate([{ $match: { ...match, date, deleted: false } }, { $group: { _id: null, quantityMl: { $sum: '$quantityMl' }, totalPaise: { $sum: '$totalPaise' }, entries: { $sum: 1 } } }]),
      Record.aggregate([{ $match: { ...match, date: { $gte: date.slice(0, 7) + '-01', $lte: date }, deleted: false } }, { $group: { _id: '$date', totalPaise: { $sum: '$totalPaise' }, quantityMl: { $sum: '$quantityMl' } } }, { $sort: { _id: 1 } }]),
      Bill.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$closingPaise' } } }]),
      Payment.aggregate([{ $match: { ...match, deleted: false, createdAt: { $gte: new Date(date.slice(0, 7) + '-01T00:00:00+05:30') } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Record.find({ ...match, deleted: false }).sort({ createdAt: -1 }).limit(6).lean(),
      Milkman.findById(req.tenant).select('businessName code').lean()
    ]);
    const ids = recent.map(r => r.customer_id);
    const customers = await Customer.find({ _id: { $in: ids }, milkman_id: req.tenant }).select('name').lean();
    ok(res, { date, customerCount, activeCustomers, today: daily[0] || { quantityMl: 0, totalPaise: 0, entries: 0 }, monthly, outstandingPaise: debt[0]?.total || 0, collectedPaise: collected[0]?.total || 0, recent: recent.map(r => ({ ...r, customerName: customers.find(c => String(c._id) === String(r.customer_id))?.name || 'Customer' })), businessName: business?.businessName });
  }));
  api.get('/customers', vendor, wrap(async (req, res) => {
    const pagination = page(req), q = String(req.query.q || '').slice(0, 100);
    const shift = req.query.shift === 'evening' ? 'evening' : 'morning';
    const sort = shift === 'evening' ? { routeEvening: 1, name: 1 } : { routeMorning: 1, name: 1 };
    const filter = { milkman_id: req.tenant, ...(q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}) };
    const [data, total] = await Promise.all([Customer.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit).lean(), Customer.countDocuments(filter)]);
    ok(res, data, { total, page: pagination.page, limit: pagination.limit });
  }));
  api.post('/customers', vendor, validate(schemas.customer), wrap(async (req, res) => {
    if (req.body.endDate && req.body.endDate < req.body.startDate) throw new AppError(400, 'INVALID_DATES', 'End date must be on or after start date.');
    const data = await change(req, 'customer.created', async session => {
      const [customer] = await Customer.create([{ ...req.body, email: req.body.email.trim().toLowerCase(), milkman_id: req.tenant }], { session });
      return { before: null, after: customer.toObject(), target: customer._id };
    }); res.status(201); ok(res, data);
  }));
  api.patch('/customers/:id/status', vendor, validate(schemas.Joi.object({ status: schemas.Joi.string().valid('active', 'inactive').required() })), wrap(async (req, res) => {
    const data = await change(req, 'customer.status.updated', async session => {
      const customer = await Customer.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
      const before = { status: customer.status }; customer.status = req.body.status; await customer.save({ session });
      return { before, after: customer.toObject(), target: customer._id };
    }); ok(res, data);
  }));
  api.get('/records', wrap(async (req, res) => {
    const p = page(req), filter = { ...scope(req), deleted: false, ...(req.query.date ? { date: validDate(req.query.date) } : {}) };
    const [data, total] = await Promise.all([Record.find(filter).sort({ date: -1, createdAt: -1 }).skip(p.skip).limit(p.limit).lean(), Record.countDocuments(filter)]);
    ok(res, data, { total, page: p.page, limit: p.limit });
  }));
  api.post('/records/batch', vendor, validate(schemas.delivery), wrap(async (req, res) => { res.status(201); ok(res, await enterDeliveries(req)); }));
  api.patch('/records/:id', vendor, validate(schemas.deliveryUpdate), wrap(async (req, res) => {
    const data = await change(req, 'delivery.corrected', async session => {
      const record = await Record.findOne({ _id: req.params.id, milkman_id: req.tenant, deleted: false }).session(session);
      if (!record) throw new AppError(404, 'NOT_FOUND', 'Delivery record was not found.');
      if (await Bill.exists({ milkman_id: req.tenant, customer_id: record.customer_id, month: { $gte: record.date.slice(0, 7) } }).session(session)) {
        throw new AppError(409, 'PERIOD_CLOSED', 'This period has been billed. Billed deliveries cannot be modified.');
      }
      const customer = await Customer.findOne({ _id: record.customer_id, milkman_id: req.tenant }).session(session);
      if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
      await Customer.updateOne({ _id: customer._id }, { $inc: { __v: 1 } }, { session });
      const newType = req.body.type || record.type;
      if (newType !== record.type) {
        const conflict = await Record.findOne({ _id: { $ne: record._id }, milkman_id: req.tenant, customer_id: record.customer_id, date: record.date, shift: record.shift, type: newType, deleted: false }).session(session);
        if (conflict) throw new AppError(409, 'DUPLICATE_RECORD', 'A delivery for this milk type already exists for this shift.');
      }
      const before = record.toObject();
      const ratePaise = newType === 'cow' ? customer.cowRatePaise : customer.buffaloRatePaise;
      record.type = newType;
      record.quantityMl = req.body.quantityMl;
      record.ratePaise = ratePaise;
      record.totalPaise = charge(record.quantityMl, ratePaise);
      await record.save({ session });
      return { before, after: record.toObject(), target: record._id };
    });
    ok(res, data);
  }));
  api.delete('/records/:id', vendor, wrap(async (req, res) => {
    const data = await change(req, 'delivery.deleted', async session => {
      const record = await Record.findOne({ _id: req.params.id, milkman_id: req.tenant, deleted: false }).session(session);
      if (!record) throw new AppError(404, 'NOT_FOUND', 'Delivery record was not found.');
      if (await Bill.exists({ milkman_id: req.tenant, customer_id: record.customer_id, month: { $gte: record.date.slice(0, 7) } }).session(session)) {
        throw new AppError(409, 'PERIOD_CLOSED', 'This period has been billed. Billed deliveries cannot be modified.');
      }
      await Customer.updateOne({ _id: record.customer_id }, { $inc: { __v: 1 } }, { session });
      const before = record.toObject();
      record.deleted = true;
      await record.save({ session });
      return { before, after: { _id: record._id, deleted: true }, target: record._id };
    });
    ok(res, data);
  }));
  api.get('/bills', wrap(async (req, res) => { const p = page(req); ok(res, await Bill.find(scope(req)).sort({ month: -1 }).skip(p.skip).limit(p.limit).lean(), { page: p.page, limit: p.limit, total: await Bill.countDocuments(scope(req)) }); }));
  api.post('/bills', vendor, validate(schemas.Joi.object({ customer_id: schemas.id.required(), month: schemas.month.required() })), wrap(async (req, res) => { res.status(201); ok(res, await generateBill(req)); }));
  api.post('/bills/batch-generate', vendor, validate(schemas.Joi.object({ month: schemas.month.optional() })), wrap(async (req, res) => {
    const summary = await runMonthlyBillingScheduler({ month: req.body.month, milkmanId: req.tenant, actorId: req.user._id });
    ok(res, summary);
  }));
  api.get('/bills/:id/pdf', wrap(async (req, res) => {
    const bill = await Bill.findOne({ _id: req.params.id, ...scope(req) }).lean();
    if (!bill) throw new AppError(404, 'NOT_FOUND', 'Bill was not found.');
    const [milkman, customer, records, payments] = await Promise.all([
      Milkman.findById(bill.milkman_id).lean(),
      Customer.findById(bill.customer_id).lean(),
      Record.find({ milkman_id: bill.milkman_id, customer_id: bill.customer_id, deleted: false, date: { $gte: bill.month + '-01', $lte: bill.month + '-31' } }).sort({ date: 1 }).lean(),
      Payment.find({ bill_id: bill._id, deleted: false, reversed: false }).sort({ createdAt: 1 }).lean()
    ]);
    const pdfBuffer = await generateBillPdf({ bill, milkman, customer, records, payments });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="gauamrut-bill-${bill.month}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  }));
  api.get('/payments', wrap(async (req, res) => {
    const p = page(req), filter = { ...scope(req), deleted: false };
    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Payment.countDocuments(filter)
    ]);
    const custIds = [...new Set(payments.map(item => String(item.customer_id)))];
    const customers = await Customer.find({ _id: { $in: custIds } }).select('name phone').lean();
    const data = payments.map(item => ({
      ...item,
      customerName: customers.find(c => String(c._id) === String(item.customer_id))?.name || 'Customer'
    }));
    ok(res, data, { page: p.page, limit: p.limit, total });
  }));
  api.post('/payments', vendor, validate(schemas.payment), wrap(async (req, res) => { res.status(201); ok(res, await recordPayment(req)); }));
  api.post('/payments/:id/reverse', vendor, validate(schemas.paymentReversal), wrap(async (req, res) => {
    const { reason } = req.body;
    const result = await change(req, 'payment.reversed', async session => {
      const payment = await Payment.findOne({ _id: req.params.id, milkman_id: req.tenant, deleted: false }).session(session);
      if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment was not found.');
      if (payment.reversed) throw new AppError(409, 'ALREADY_REVERSED', 'This payment has already been reversed.');

      const before = payment.toObject();
      let bill = null;
      if (payment.bill_id) {
        bill = await Bill.findOne({ _id: payment.bill_id, milkman_id: req.tenant }).session(session);
        if (bill) {
          bill.closingPaise += payment.amountPaise;
          bill.paidPaise = Math.max(0, bill.paidPaise - payment.amountPaise);
          await bill.save({ session });
        }
      }

      payment.reversed = true;
      payment.reversalReason = reason;
      payment.reversedAt = new Date();
      payment.reversedBy = req.user._id;
      await payment.save({ session });

      const after = payment.toObject();
      if (bill) after.bill = bill.toObject();
      return { before, after, target: payment._id };
    });
    ok(res, result);
  }));
  api.get('/payments/:id/receipt', wrap(async (req, res) => {
    const payment = await Payment.findOne({ _id: req.params.id, ...scope(req), deleted: false }).lean();
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment was not found.');
    const [milkman, customer, bill] = await Promise.all([
      Milkman.findById(payment.milkman_id).lean(),
      Customer.findById(payment.customer_id).lean(),
      payment.bill_id ? Bill.findById(payment.bill_id).lean() : null
    ]);
    ok(res, {
      receipt: payment.receipt,
      date: payment.createdAt,
      method: payment.method,
      reference: payment.reference || null,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      billMonth: bill ? bill.month : null,
      reversed: payment.reversed || false,
      reversalReason: payment.reversalReason || null,
      reversedAt: payment.reversedAt || null,
      dairy: {
        businessName: milkman?.businessName || 'GauAmrut Dairy',
        ownerName: milkman?.name || 'Dairy Owner',
        phone: milkman?.phone || '',
        upiId: milkman?.upiId || ''
      },
      customer: {
        name: customer?.name || 'Customer',
        phone: customer?.phone || '',
        address: customer?.address || ''
      },
      balanceAfterPaise: bill ? bill.closingPaise : null,
      verified: true
    });
  }));
  api.get('/adjustments', wrap(async (req, res) => {
    const p = page(req);
    const filter = { ...scope(req) };
    if (req.query.customer_id) filter.customer_id = req.query.customer_id;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const [items, total] = await Promise.all([
      Adjustment.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Adjustment.countDocuments(filter)
    ]);

    const custIds = [...new Set(items.map(i => String(i.customer_id)))];
    const billIds = [...new Set(items.filter(i => i.bill_id).map(i => String(i.bill_id)))];

    const [customers, bills] = await Promise.all([
      Customer.find({ _id: { $in: custIds } }).select('name phone').lean(),
      Bill.find({ _id: { $in: billIds } }).select('month').lean()
    ]);

    const data = items.map(item => ({
      ...item,
      customerName: customers.find(c => String(c._id) === String(item.customer_id))?.name || 'Customer',
      billMonth: bills.find(b => String(b._id) === String(item.bill_id))?.month || null
    }));

    ok(res, data, { page: p.page, limit: p.limit, total });
  }));
  api.post('/adjustments', vendor, validate(schemas.adjustment), wrap(async (req, res) => {
    const { customer_id, bill_id, type, amountPaise, reason, reference } = req.body;
    const customer = await Customer.findOne({ _id: customer_id, milkman_id: req.tenant });
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');

    const result = await change(req, `adjustment.${type}`, async session => {
      let targetBill = null;
      if (bill_id) {
        targetBill = await Bill.findOne({ _id: bill_id, milkman_id: req.tenant, customer_id }).session(session);
        if (!targetBill) throw new AppError(404, 'NOT_FOUND', 'Specified bill was not found.');
      } else if (type === 'credit' || type === 'waiver') {
        targetBill = await Bill.findOne({ customer_id, milkman_id: req.tenant, closingPaise: { $gt: 0 } }).sort({ month: 1 }).session(session);
      } else {
        targetBill = await Bill.findOne({ customer_id, milkman_id: req.tenant }).sort({ month: -1 }).session(session);
      }

      if (type === 'credit' || type === 'waiver') {
        if (!targetBill) {
          throw new AppError(409, 'NO_OUTSTANDING_BILLS', 'Customer has no outstanding bills to apply credit or waiver to.');
        }
        if (targetBill.closingPaise < amountPaise) {
          throw new AppError(409, 'INVALID_ADJUSTMENT', 'Credit or waiver cannot exceed the bill outstanding balance.');
        }
        targetBill.closingPaise -= amountPaise;
        await targetBill.save({ session });
      } else if (type === 'debit' || type === 'refund') {
        if (!targetBill) {
          throw new AppError(409, 'NO_BILLS_FOUND', 'Customer must have at least one bill to record a debit or refund against.');
        }
        targetBill.closingPaise += amountPaise;
        await targetBill.save({ session });
      }

      const [adj] = await Adjustment.create([{
        milkman_id: req.tenant,
        customer_id,
        ...(targetBill ? { bill_id: targetBill._id } : {}),
        type,
        amountPaise,
        reason,
        reference: reference || undefined,
        actor: req.user._id,
        status: 'applied'
      }], { session });

      return {
        before: null,
        after: {
          adjustment: adj.toObject(),
          bill: targetBill ? targetBill.toObject() : null
        },
        target: adj._id
      };
    });
    res.status(201);
    ok(res, result);
  }));
  api.post('/adjustments/:id/reverse', vendor, validate(schemas.adjustmentReversal), wrap(async (req, res) => {
    const { reason } = req.body;
    const result = await change(req, 'adjustment.reversed', async session => {
      const adj = await Adjustment.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!adj) throw new AppError(404, 'NOT_FOUND', 'Adjustment was not found.');
      if (adj.status === 'reversed') throw new AppError(409, 'ALREADY_REVERSED', 'This adjustment has already been reversed.');

      const before = adj.toObject();
      let bill = null;
      if (adj.bill_id) {
        bill = await Bill.findOne({ _id: adj.bill_id, milkman_id: req.tenant }).session(session);
        if (bill) {
          if (adj.type === 'credit' || adj.type === 'waiver') {
            bill.closingPaise += adj.amountPaise;
          } else if (adj.type === 'debit' || adj.type === 'refund') {
            bill.closingPaise = Math.max(0, bill.closingPaise - adj.amountPaise);
          }
          await bill.save({ session });
        }
      }

      adj.status = 'reversed';
      adj.reversalReason = reason;
      adj.reversedAt = new Date();
      adj.reversedBy = req.user._id;
      await adj.save({ session });

      const after = adj.toObject();
      if (bill) after.bill = bill.toObject();
      return { before, after, target: adj._id };
    });
    ok(res, result);
  }));
  api.post('/payment-claims', validate(schemas.paymentClaim), wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const customerId = isCustomer ? req.user.customer_id : (req.body.customer_id || req.user.customer_id);
    if (!customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Customer identity is required to claim a payment.');
    const customer = await Customer.findOne({ _id: customerId, milkman_id: req.tenant });
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
    const duplicate = await PaymentRequest.findOne({
      milkman_id: req.tenant,
      reference: req.body.reference,
      status: { $ne: 'rejected' }
    });
    if (duplicate) throw new AppError(409, 'DUPLICATE_REFERENCE', 'A payment claim with this reference number already exists.');
    const [claim] = await PaymentRequest.create([{
      milkman_id: req.tenant,
      customer_id: customerId,
      bill_id: req.body.bill_id || null,
      amountPaise: req.body.amountPaise,
      method: req.body.method,
      reference: req.body.reference,
      notes: req.body.notes || '',
      status: 'pending'
    }]);
    if (isCustomer) {
      const milkmanUser = await User.findOne({ milkman_id: req.tenant, role: 'milkman' });
      if (milkmanUser) {
        await createNotification({
          recipient: milkmanUser._id,
          role: 'milkman',
          tenant: req.tenant,
          type: 'payment_claim',
          title: 'Payment Claim Submitted',
          message: `${customer.name} submitted a payment claim of Rs. ${(req.body.amountPaise / 100).toFixed(2)} (Ref: ${req.body.reference}).`,
          link: '/payments',
          relatedId: claim._id
        });
      }
    }
    res.status(201);
    ok(res, claim.toObject());
  }));
  api.get('/payment-claims', wrap(async (req, res) => {
    const p = page(req);
    const filter = req.user.role === 'customer'
      ? { customer_id: req.user.customer_id }
      : { milkman_id: req.tenant, ...(req.query.status ? { status: req.query.status } : {}) };
    const [data, total] = await Promise.all([
      PaymentRequest.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      PaymentRequest.countDocuments(filter)
    ]);
    const custIds = [...new Set(data.map(d => String(d.customer_id)))];
    const customers = await Customer.find({ _id: { $in: custIds } }).select('name phone').lean();
    const result = data.map(d => ({
      ...d,
      customerName: customers.find(c => String(c._id) === String(d.customer_id))?.name || 'Customer'
    }));
    ok(res, result, { page: p.page, limit: p.limit, total });
  }));
  api.patch('/payment-claims/:id/review', vendor, validate(schemas.claimReview), wrap(async (req, res) => {
    const { action, reason } = req.body;
    const result = await change(req, `payment.claim.${action}`, async session => {
      const claim = await PaymentRequest.findOne({ _id: req.params.id, milkman_id: req.tenant, status: 'pending' }).session(session);
      if (!claim) throw new AppError(404, 'NOT_FOUND', 'Pending payment claim was not found.');
      if (action === 'reject') {
        const before = claim.toObject();
        claim.status = 'rejected';
        claim.rejectionReason = reason;
        claim.reviewedBy = req.user._id;
        claim.reviewedAt = new Date();
        await claim.save({ session });
        return { before, after: claim.toObject(), target: claim._id };
      }
      let bill;
      if (claim.bill_id) {
        bill = await Bill.findOne({ _id: claim.bill_id, milkman_id: req.tenant }).session(session);
      } else {
        bill = await Bill.findOne({ customer_id: claim.customer_id, milkman_id: req.tenant, closingPaise: { $gt: 0 } }).sort({ month: 1 }).session(session);
      }
      if (!bill) throw new AppError(409, 'NO_OUTSTANDING_BILLS', 'Customer has no outstanding bills to allocate this payment to.');
      if (bill.closingPaise < claim.amountPaise) throw new AppError(409, 'INVALID_PAYMENT', 'Claim amount exceeds outstanding bill balance.');
      bill.paidPaise += claim.amountPaise;
      bill.closingPaise -= claim.amountPaise;
      await bill.save({ session });
      const receipt = 'GA-' + crypto.randomUUID();
      const [payment] = await Payment.create([{
        milkman_id: req.tenant,
        customer_id: claim.customer_id,
        bill_id: bill._id,
        amountPaise: claim.amountPaise,
        method: claim.method,
        reference: claim.reference,
        receipt
      }], { session });
      const before = claim.toObject();
      claim.status = 'approved';
      claim.reviewedBy = req.user._id;
      claim.reviewedAt = new Date();
      claim.payment_id = payment._id;
      await claim.save({ session });
      return { before, after: { claim: claim.toObject(), payment: payment.toObject() }, target: claim._id };
    });

    const targetCustomer = await Customer.findById(result.claim ? result.claim.customer_id : result.customer_id);
    if (targetCustomer?.user_id) {
      await createNotification({
        recipient: targetCustomer.user_id,
        role: 'customer',
        tenant: req.tenant,
        type: 'payment_claim',
        title: `Payment Claim ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        message: action === 'approve'
          ? `Your payment of Rs. ${(result.payment.amountPaise / 100).toFixed(2)} was verified and credited.`
          : `Your payment claim was rejected.${reason ? ` Reason: ${reason}` : ''}`,
        link: '/payments',
        relatedId: result.claim ? result.claim._id : result._id
      });
    }

    ok(res, result);
  }));
  // Products
  api.get('/products', wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const filter = isCustomer
      ? { milkman_id: req.tenant, available: true, deleted: false }
      : { milkman_id: req.tenant, deleted: false };
    const products = await Product.find(filter).sort({ name: 1 }).lean();
    ok(res, products);
  }));
  api.post('/products', vendor, validate(schemas.product), wrap(async (req, res) => {
    const result = await change(req, 'product.created', async session => {
      const [product] = await Product.create([{
        milkman_id: req.tenant,
        ...req.body,
        deleted: false
      }], { session });
      return { before: null, after: product.toObject(), target: product._id };
    });
    res.status(201);
    ok(res, result);
  }));
  api.patch('/products/:id', vendor, validate(schemas.productUpdate), wrap(async (req, res) => {
    const result = await change(req, 'product.updated', async session => {
      const product = await Product.findOne({ _id: req.params.id, milkman_id: req.tenant, deleted: false }).session(session);
      if (!product) throw new AppError(404, 'NOT_FOUND', 'Product was not found.');
      const before = product.toObject();
      Object.assign(product, req.body);
      await product.save({ session });
      return { before, after: product.toObject(), target: product._id };
    });
    ok(res, result);
  }));
  api.delete('/products/:id', vendor, wrap(async (req, res) => {
    const result = await change(req, 'product.deleted', async session => {
      const product = await Product.findOne({ _id: req.params.id, milkman_id: req.tenant, deleted: false }).session(session);
      if (!product) throw new AppError(404, 'NOT_FOUND', 'Product was not found.');
      const before = product.toObject();
      product.deleted = true;
      await product.save({ session });
      return { before, after: product.toObject(), target: product._id };
    });
    ok(res, { deleted: true, _id: result._id });
  }));

  // Orders
  api.post('/orders', validate(schemas.order), wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const customerId = isCustomer ? req.user.customer_id : (req.body.customer_id || req.user.customer_id);
    if (!customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Customer identity is required to place an order.');
    const customer = await Customer.findOne({ _id: customerId, milkman_id: req.tenant });
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');

    const productIds = req.body.items.map(i => i.product_id);
    const products = await Product.find({ _id: { $in: productIds }, milkman_id: req.tenant, deleted: false }).lean();
    if (products.length !== new Set(productIds).size) {
      throw new AppError(400, 'PRODUCT_NOT_FOUND', 'One or more products in order could not be found.');
    }

    for (const prod of products) {
      if (!prod.available) {
        throw new AppError(400, 'PRODUCT_UNAVAILABLE', `Product "${prod.name}" is currently marked unavailable.`);
      }
    }

    const prodMap = new Map(products.map(p => [String(p._id), p]));
    let totalPaise = 0;
    const snapshottedItems = req.body.items.map(item => {
      const p = prodMap.get(String(item.product_id));
      const lineTotal = p.pricePaise * item.quantity;
      totalPaise += lineTotal;
      return {
        product_id: p._id,
        name: p.name,
        unit: p.unit,
        unitPricePaise: p.pricePaise,
        quantity: item.quantity,
        totalPaise: lineTotal
      };
    });

    const result = await change(req, 'order.placed', async session => {
      const [order] = await Order.create([{
        milkman_id: req.tenant,
        customer_id: customerId,
        items: snapshottedItems,
        totalPaise,
        deliveryDate: req.body.deliveryDate,
        shift: req.body.shift || 'morning',
        status: 'placed',
        notes: req.body.notes || ''
      }], { session });
      return { before: null, after: order.toObject(), target: order._id };
    });

    if (isCustomer) {
      const milkmanUser = await User.findOne({ milkman_id: req.tenant, role: 'milkman' });
      if (milkmanUser) {
        await createNotification({
          recipient: milkmanUser._id,
          role: 'milkman',
          tenant: req.tenant,
          type: 'order_status',
          title: 'New Store Order',
          message: `${customer.name} placed an order for Rs. ${(totalPaise / 100).toFixed(2)} for ${req.body.deliveryDate}.`,
          link: '/orders',
          relatedId: result._id
        });
      }
    }

    res.status(201);
    ok(res, result);
  }));

  api.get('/orders', wrap(async (req, res) => {
    const p = page(req);
    const isCustomer = req.user.role === 'customer';
    const filter = isCustomer
      ? { milkman_id: req.tenant, customer_id: req.user.customer_id }
      : {
          milkman_id: req.tenant,
          ...(req.query.customer_id ? { customer_id: req.query.customer_id } : {}),
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.deliveryDate ? { deliveryDate: req.query.deliveryDate } : {})
        };
    if (isCustomer && req.query.status) {
      filter.status = req.query.status;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Order.countDocuments(filter)
    ]);

    const custIds = [...new Set(orders.map(o => String(o.customer_id)))];
    const customers = await Customer.find({ _id: { $in: custIds } }).select('name phone').lean();
    const customerMap = new Map(customers.map(c => [String(c._id), c]));

    const result = orders.map(o => {
      const c = customerMap.get(String(o.customer_id));
      return {
        ...o,
        customerName: c?.name || 'Customer',
        customerPhone: c?.phone || ''
      };
    });
    ok(res, result, { page: p.page, limit: p.limit, total });
  }));

  api.patch('/orders/:id/status', validate(schemas.orderStatus), wrap(async (req, res) => {
    const { status: newStatus, reason } = req.body;
    const isCustomer = req.user.role === 'customer';

    const result = await change(req, `order.status.${newStatus}`, async session => {
      const order = await Order.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Order was not found.');

      if (isCustomer) {
        if (String(order.customer_id) !== String(req.user.customer_id)) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot modify an order belonging to another customer.');
        }
        if (newStatus !== 'cancelled') {
          throw new AppError(403, 'FORBIDDEN', 'Customers can only cancel placed orders.');
        }
        if (order.status !== 'placed') {
          throw new AppError(409, 'INVALID_ORDER_STATE', 'Only orders in "placed" state can be cancelled by the customer.');
        }
      } else {
        if (order.status === 'fulfilled' || order.status === 'cancelled') {
          throw new AppError(409, 'INVALID_ORDER_STATE', `Cannot change status of an order that is already ${order.status}.`);
        }
        if (newStatus === 'confirmed' && order.status !== 'placed') {
          throw new AppError(409, 'INVALID_ORDER_STATE', `Only "placed" orders can be confirmed (current: ${order.status}).`);
        }
        if (newStatus === 'fulfilled' && order.status !== 'confirmed') {
          throw new AppError(409, 'INVALID_ORDER_STATE', `Only "confirmed" orders can be marked fulfilled (current: ${order.status}).`);
        }
      }

      const before = order.toObject();
      order.status = newStatus;
      if (newStatus === 'cancelled') {
        order.cancellationReason = reason;
        order.cancelledBy = req.user._id;
        order.cancelledAt = new Date();
      } else if (newStatus === 'fulfilled') {
        order.fulfilledAt = new Date();
      }
      await order.save({ session });
      return { before, after: order.toObject(), target: order._id };
    });

    if (!isCustomer) {
      const targetCust = await Customer.findById(result.customer_id);
      if (targetCust?.user_id) {
        await createNotification({
          recipient: targetCust.user_id,
          role: 'customer',
          tenant: req.tenant,
          type: 'order_status',
          title: `Order ${newStatus.toUpperCase()}`,
          message: `Your store order for ${result.deliveryDate} is now ${newStatus}.${reason ? ` Reason: ${reason}` : ''}`,
          link: '/orders',
          relatedId: result._id
        });
      }
    }

    ok(res, result);
  }));

  // Disputes
  api.post('/disputes', validate(schemas.dispute), wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const customerId = isCustomer ? req.user.customer_id : (req.body.customer_id || req.user.customer_id);
    if (!customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Customer identity is required to create a dispute.');
    const customer = await Customer.findOne({ _id: customerId, milkman_id: req.tenant });
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');

    const authorName = req.user.name || (isCustomer ? customer.name : 'Dairy');
    const result = await change(req, 'dispute.created', async session => {
      const [dispute] = await Dispute.create([{
        milkman_id: req.tenant,
        customer_id: customerId,
        type: req.body.type,
        targetType: req.body.targetType || 'general',
        targetId: req.body.targetId || null,
        title: req.body.title,
        description: req.body.description,
        status: 'open',
        replies: [{
          actor: req.user._id,
          role: req.user.role,
          authorName,
          message: req.body.description,
          createdAt: new Date()
        }]
      }], { session });
      return { before: null, after: dispute.toObject(), target: dispute._id };
    });

    if (isCustomer) {
      const milkmanUser = await User.findOne({ milkman_id: req.tenant, role: 'milkman' });
      if (milkmanUser) {
        await createNotification({
          recipient: milkmanUser._id,
          role: 'milkman',
          tenant: req.tenant,
          type: 'dispute_reply',
          title: 'New Dispute Raised',
          message: `${customer.name} raised dispute: "${req.body.title}".`,
          link: '/disputes',
          relatedId: result._id
        });
      }
    }

    res.status(201);
    ok(res, result);
  }));

  api.get('/disputes', wrap(async (req, res) => {
    const p = page(req);
    const isCustomer = req.user.role === 'customer';
    const filter = isCustomer
      ? { milkman_id: req.tenant, customer_id: req.user.customer_id }
      : {
          milkman_id: req.tenant,
          ...(req.query.status ? { status: req.query.status } : {}),
          ...(req.query.type ? { type: req.query.type } : {})
        };
    if (isCustomer && req.query.status) {
      filter.status = req.query.status;
    }

    const [disputes, total] = await Promise.all([
      Dispute.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      Dispute.countDocuments(filter)
    ]);

    const custIds = [...new Set(disputes.map(d => String(d.customer_id)))];
    const customers = await Customer.find({ _id: { $in: custIds } }).select('name phone').lean();
    const customerMap = new Map(customers.map(c => [String(c._id), c]));

    const result = disputes.map(d => {
      const c = customerMap.get(String(d.customer_id));
      return {
        ...d,
        customerName: c?.name || 'Customer',
        customerPhone: c?.phone || ''
      };
    });
    ok(res, result, { page: p.page, limit: p.limit, total });
  }));

  api.get('/disputes/:id', wrap(async (req, res) => {
    const dispute = await Dispute.findOne({ _id: req.params.id, milkman_id: req.tenant }).lean();
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute was not found.');
    if (req.user.role === 'customer' && String(dispute.customer_id) !== String(req.user.customer_id)) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot view a dispute belonging to another customer.');
    }
    const customer = await Customer.findById(dispute.customer_id).select('name phone address').lean();
    ok(res, {
      ...dispute,
      customerName: customer?.name || 'Customer',
      customerPhone: customer?.phone || ''
    });
  }));

  api.post('/disputes/:id/replies', validate(schemas.disputeReply), wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const authorName = req.user.name || (isCustomer ? 'Customer' : 'Dairy');

    const result = await change(req, 'dispute.reply', async session => {
      const dispute = await Dispute.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute was not found.');
      if (isCustomer && String(dispute.customer_id) !== String(req.user.customer_id)) {
        throw new AppError(403, 'FORBIDDEN', 'Cannot reply to a dispute belonging to another customer.');
      }
      if (dispute.status === 'resolved' || dispute.status === 'cancelled') {
        throw new AppError(409, 'DISPUTE_CLOSED', `Cannot reply to a dispute that is already ${dispute.status}.`);
      }

      const before = dispute.toObject();
      dispute.replies.push({
        actor: req.user._id,
        role: req.user.role,
        authorName,
        message: req.body.message,
        createdAt: new Date()
      });

      if (!isCustomer && dispute.status === 'open') {
        dispute.status = 'under_review';
      }

      await dispute.save({ session });
      return { before, after: dispute.toObject(), target: dispute._id };
    });

    if (isCustomer) {
      const milkmanUser = await User.findOne({ milkman_id: req.tenant, role: 'milkman' });
      if (milkmanUser) {
        await createNotification({
          recipient: milkmanUser._id,
          role: 'milkman',
          tenant: req.tenant,
          type: 'dispute_reply',
          title: 'Reply on Dispute',
          message: `Customer replied on "${result.title}".`,
          link: '/disputes',
          relatedId: result._id
        });
      }
    } else {
      const cust = await Customer.findById(result.customer_id);
      if (cust?.user_id) {
        await createNotification({
          recipient: cust.user_id,
          role: 'customer',
          tenant: req.tenant,
          type: 'dispute_reply',
          title: 'Dairy Replied to Dispute',
          message: `Dairy replied to your dispute "${result.title}".`,
          link: '/disputes',
          relatedId: result._id
        });
      }
    }

    ok(res, result);
  }));

  api.patch('/disputes/:id/status', validate(schemas.disputeStatus), wrap(async (req, res) => {
    const { status: newStatus, resolutionNotes } = req.body;
    const isCustomer = req.user.role === 'customer';

    const result = await change(req, `dispute.status.${newStatus}`, async session => {
      const dispute = await Dispute.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute was not found.');

      if (isCustomer) {
        if (String(dispute.customer_id) !== String(req.user.customer_id)) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot modify a dispute belonging to another customer.');
        }
        if (newStatus !== 'cancelled') {
          throw new AppError(403, 'FORBIDDEN', 'Customers can only cancel open disputes.');
        }
      }

      if (dispute.status === 'resolved' || dispute.status === 'cancelled') {
        throw new AppError(409, 'DISPUTE_CLOSED', `Dispute is already ${dispute.status}.`);
      }

      const before = dispute.toObject();
      dispute.status = newStatus;
      if (newStatus === 'resolved') {
        dispute.resolutionNotes = resolutionNotes;
        dispute.resolvedAt = new Date();
        dispute.resolvedBy = req.user._id;
      }
      await dispute.save({ session });
      return { before, after: dispute.toObject(), target: dispute._id };
    });

    if (!isCustomer) {
      const cust = await Customer.findById(result.customer_id);
      if (cust?.user_id) {
        await createNotification({
          recipient: cust.user_id,
          role: 'customer',
          tenant: req.tenant,
          type: 'dispute_reply',
          title: `Dispute ${newStatus.toUpperCase()}`,
          message: `Your dispute "${result.title}" has been marked ${newStatus}.${resolutionNotes ? ` Note: ${resolutionNotes}` : ''}`,
          link: '/disputes',
          relatedId: result._id
        });
      }
    }

    ok(res, result);
  }));

  // Delivery Adjustments (Vacation pause & Extra deliveries)
  api.post('/delivery-adjustments', validate(schemas.deliveryAdjustment), wrap(async (req, res) => {
    const isCustomer = req.user.role === 'customer';
    const customerId = isCustomer ? req.user.customer_id : (req.body.customer_id || req.user.customer_id);
    if (!customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'Customer identity is required.');
    const customer = await Customer.findOne({ _id: customerId, milkman_id: req.tenant });
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');

    if (req.body.endDate < req.body.startDate) {
      throw new AppError(400, 'INVALID_DATE_RANGE', 'End date must be on or after start date.');
    }

    const overlap = await DeliveryAdjustment.findOne({
      milkman_id: req.tenant,
      customer_id: customerId,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { startDate: { $lte: req.body.endDate }, endDate: { $gte: req.body.startDate } }
      ]
    });
    if (overlap) {
      throw new AppError(409, 'OVERLAPPING_ADJUSTMENT', 'An active or pending adjustment already exists for this date range.');
    }

    const initialStatus = isCustomer ? 'pending' : 'approved';
    const [adjustment] = await DeliveryAdjustment.create([{
      milkman_id: req.tenant,
      customer_id: customerId,
      type: req.body.type,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      shift: req.body.shift || 'all',
      cowMl: req.body.cowMl || 0,
      buffaloMl: req.body.buffaloMl || 0,
      status: initialStatus,
      notes: req.body.notes || '',
      requestedBy: req.user._id,
      ...(isCustomer ? {} : { reviewedBy: req.user._id, reviewedAt: new Date() })
    }]);

    if (isCustomer) {
      const milkmanUser = await User.findOne({ milkman_id: req.tenant, role: 'milkman' });
      if (milkmanUser) {
        await createNotification({
          recipient: milkmanUser._id,
          role: 'milkman',
          tenant: req.tenant,
          type: 'delivery_adjustment',
          title: req.body.type === 'vacation' ? 'Vacation Pause Request' : 'Extra Milk Request',
          message: `${customer.name} requested ${req.body.type} from ${req.body.startDate} to ${req.body.endDate}.`,
          link: '/records',
          relatedId: adjustment._id
        });
      }
    }

    res.status(201);
    ok(res, adjustment.toObject());
  }));

  api.get('/delivery-adjustments', wrap(async (req, res) => {
    const p = page(req);
    const isCustomer = req.user.role === 'customer';
    const filter = isCustomer
      ? { customer_id: req.user.customer_id }
      : { milkman_id: req.tenant, ...(req.query.status ? { status: req.query.status } : {}) };

    const [adjustments, total] = await Promise.all([
      DeliveryAdjustment.find(filter).sort({ startDate: -1, createdAt: -1 }).skip(p.skip).limit(p.limit).lean(),
      DeliveryAdjustment.countDocuments(filter)
    ]);

    const custIds = [...new Set(adjustments.map(a => String(a.customer_id)))];
    const customers = await Customer.find({ _id: { $in: custIds } }).select('name phone').lean();
    const custMap = new Map(customers.map(c => [String(c._id), c]));

    const result = adjustments.map(a => ({
      ...a,
      customerName: custMap.get(String(a.customer_id))?.name || 'Customer',
      customerPhone: custMap.get(String(a.customer_id))?.phone || ''
    }));

    ok(res, result, { page: p.page, limit: p.limit, total });
  }));

  api.get('/delivery-adjustments/active', wrap(async (req, res) => {
    const date = req.query.date || today();
    const filter = {
      milkman_id: req.tenant,
      status: 'approved',
      startDate: { $lte: date },
      endDate: { $gte: date }
    };
    if (req.user.role === 'customer') {
      filter.customer_id = req.user.customer_id;
    }
    const adjustments = await DeliveryAdjustment.find(filter).lean();
    ok(res, adjustments);
  }));

  api.patch('/delivery-adjustments/:id/status', validate(schemas.deliveryAdjustmentStatus), wrap(async (req, res) => {
    const { status: newStatus, rejectionReason } = req.body;
    const isCustomer = req.user.role === 'customer';

    const adj = await DeliveryAdjustment.findOne({ _id: req.params.id, milkman_id: req.tenant });
    if (!adj) throw new AppError(404, 'NOT_FOUND', 'Delivery adjustment was not found.');

    if (isCustomer) {
      if (String(adj.customer_id) !== String(req.user.customer_id)) {
        throw new AppError(403, 'FORBIDDEN', 'Cannot modify another customer’s adjustment.');
      }
      if (newStatus !== 'cancelled') {
        throw new AppError(403, 'FORBIDDEN', 'Customers can only cancel their own pending adjustments.');
      }
      if (adj.status !== 'pending') {
        throw new AppError(409, 'INVALID_STATE', `Only pending adjustments can be cancelled (current: ${adj.status}).`);
      }
    } else {
      if (adj.status !== 'pending') {
        throw new AppError(409, 'INVALID_STATE', `Adjustment is already ${adj.status}.`);
      }
    }

    adj.status = newStatus;
    if (newStatus === 'rejected') {
      adj.rejectionReason = rejectionReason;
    }
    if (!isCustomer) {
      adj.reviewedBy = req.user._id;
      adj.reviewedAt = new Date();
    }
    await adj.save();

    if (!isCustomer) {
      const customer = await Customer.findById(adj.customer_id);
      if (customer?.user_id) {
        await createNotification({
          recipient: customer.user_id,
          role: 'customer',
          tenant: req.tenant,
          type: 'delivery_adjustment',
          title: `Delivery Adjustment ${newStatus === 'approved' ? 'Approved' : 'Declined'}`,
          message: `Your ${adj.type} request for ${adj.startDate} to ${adj.endDate} has been ${newStatus}.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
          link: '/records',
          relatedId: adj._id
        });
      }
    }

    ok(res, adj.toObject());
  }));

  // In-App Notifications
  api.get('/notifications', wrap(async (req, res) => {
    const result = await getNotifications(req.user, req.query);
    ok(res, result.notifications, result.meta);
  }));

  api.patch('/notifications/:id/read', wrap(async (req, res) => {
    const notif = await markRead(req.user, req.params.id);
    if (!notif) throw new AppError(404, 'NOT_FOUND', 'Notification was not found.');
    ok(res, notif);
  }));

  api.post('/notifications/read-all', wrap(async (req, res) => {
    const result = await markAllRead(req.user);
    ok(res, result);
  }));

  // Additional CSV Reports
  api.get('/reports/payments.csv', wrap(async (req, res) => {
    const month = req.query.month || today().slice(0, 7);
    if (schemas.month.validate(month).error) throw new AppError(400, 'INVALID_MONTH', 'Use YYYY-MM for the report month.');
    const filter = { ...scope(req), deleted: false, createdAt: { $gte: new Date(month + '-01T00:00:00+05:30'), $lte: new Date(month + '-31T23:59:59+05:30') } };
    const payments = await Payment.find(filter).sort({ createdAt: 1 }).lean();
    const custIds = [...new Set(payments.map(p => String(p.customer_id)))];
    const [customers, business] = await Promise.all([
      Customer.find({ _id: { $in: custIds } }).select('name phone').lean(),
      Milkman.findById(req.tenant).lean()
    ]);
    const custMap = new Map(customers.map(c => [String(c._id), c.name]));
    const content = [
      ['Business', business?.businessName || 'GauAmrut Dairy'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Receipt', 'Date', 'Customer', 'Method', 'Reference', 'Amount Paise', 'Reversed'],
      ...payments.map(p => [
        p.receipt || '',
        new Date(p.createdAt).toLocaleDateString('en-IN'),
        custMap.get(String(p.customer_id)) || 'Customer',
        p.method,
        p.reference || '',
        p.amountPaise,
        p.reversed ? 'Yes' : 'No'
      ]),
      ['Total Paise', payments.filter(p => !p.reversed).reduce((sum, p) => sum + p.amountPaise, 0)]
    ].map(r => r.map(csvCell).join(',')).join('\r\n');

    res.set('Content-Disposition', `attachment; filename="gauamrut-payments-${month}.csv"`).type('text/csv').send(content);
  }));

  api.get('/reports/orders.csv', wrap(async (req, res) => {
    const month = req.query.month || today().slice(0, 7);
    if (schemas.month.validate(month).error) throw new AppError(400, 'INVALID_MONTH', 'Use YYYY-MM for the report month.');
    const filter = { ...scope(req), deliveryDate: { $gte: month + '-01', $lte: month + '-31' } };
    const orders = await Order.find(filter).sort({ deliveryDate: 1 }).lean();
    const custIds = [...new Set(orders.map(o => String(o.customer_id)))];
    const [customers, business] = await Promise.all([
      Customer.find({ _id: { $in: custIds } }).select('name phone').lean(),
      Milkman.findById(req.tenant).lean()
    ]);
    const custMap = new Map(customers.map(c => [String(c._id), c.name]));
    const content = [
      ['Business', business?.businessName || 'GauAmrut Dairy'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Order ID', 'Delivery Date', 'Shift', 'Customer', 'Items', 'Total Paise', 'Status'],
      ...orders.map(o => [
        String(o._id),
        o.deliveryDate,
        o.shift,
        custMap.get(String(o.customer_id)) || 'Customer',
        o.items.map(i => `${i.name} (${i.quantity} ${i.unit})`).join('; '),
        o.totalPaise,
        o.status
      ]),
      ['Total Paise', orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.totalPaise, 0)]
    ].map(r => r.map(csvCell).join(',')).join('\r\n');

    res.set('Content-Disposition', `attachment; filename="gauamrut-orders-${month}.csv"`).type('text/csv').send(content);
  }));

  api.get('/reports/customer-summary.csv', wrap(async (req, res) => {
    const customers = await Customer.find({ milkman_id: req.tenant }).sort({ name: 1 }).lean();
    const business = await Milkman.findById(req.tenant).lean();
    const custIds = customers.map(c => c._id);
    const bills = await Bill.aggregate([
      { $match: { milkman_id: req.tenant, customer_id: { $in: custIds } } },
      { $group: { _id: '$customer_id', totalClosing: { $sum: '$closingPaise' } } }
    ]);
    const billMap = new Map(bills.map(b => [String(b._id), b.totalClosing]));
    const content = [
      ['Business', business?.businessName || 'GauAmrut Dairy'],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Name', 'Phone', 'Address', 'Status', 'Cow Rate Paise', 'Buffalo Rate Paise', 'Outstanding Paise'],
      ...customers.map(c => [
        c.name,
        c.phone,
        c.address || '',
        c.status,
        c.cowRatePaise,
        c.buffaloRatePaise,
        billMap.get(String(c._id)) || 0
      ])
    ].map(r => r.map(csvCell).join(',')).join('\r\n');

    res.set('Content-Disposition', 'attachment; filename="gauamrut-customers-summary.csv"').type('text/csv').send(content);
  }));

  api.get('/reports/deliveries.csv', wrap(async (req, res) => {
    const month = req.query.month || today().slice(0, 7);
    if (schemas.month.validate(month).error) throw new AppError(400, 'INVALID_MONTH', 'Use YYYY-MM for the report month.');
    const filter = { ...scope(req), deleted: false, date: { $gte: month + '-01', $lte: month + '-31' } };
    if (await Record.countDocuments(filter) > 5000) throw new AppError(422, 'EXPORT_TOO_LARGE', 'This release supports up to 5,000 rows per export. Choose a smaller report period.');
    const rows = await Record.find(filter).sort({ date: 1 }).lean();
    const business = await Milkman.findById(req.tenant).lean();
    const content = [['Business', business.businessName], ['Period', month], ['Generated', new Date().toISOString()], ['Currency', 'INR'], ['Date', 'Customer ID', 'Shift', 'Type', 'Quantity ml', 'Rate paise/L', 'Total paise'], ...rows.map(r => [r.date, r.customer_id, r.shift, r.type, r.quantityMl, r.ratePaise, r.totalPaise]), ['Total paise', rows.reduce((n, r) => n + r.totalPaise, 0)]].map(r => r.map(csvCell).join(',')).join('\r\n');
    res.set('Content-Disposition', `attachment; filename="gauamrut-deliveries-${month}.csv"`).type('text/csv').send(content);
  }));
  app.use('/api', api);
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint was not found.')));
  app.use((error, req, res, _next) => {
    const status = error.status || (error.code === 11000 ? 409 : ['ValidationError', 'CastError', 'StrictModeError'].includes(error.name) ? 400 : 500);
    if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId, code: error.code || error.name }));
    res.status(status).json({ error: { code: error.code === 11000 ? 'DUPLICATE_RECORD' : typeof error.code === 'string' ? error.code : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: status >= 500 ? 'The service could not complete this request. Please retry.' : error.code === 11000 ? 'This record already exists.' : error.message } });
  });
  return app;
}
module.exports = { createApp };
