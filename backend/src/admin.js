const express = require('express');
const { User, Milkman, Customer, Record, Bill, Payment, Audit, Dispute, AdminSetting, Order } = require('./models');
const { AppError, today } = require('./domain');
const { wrap, validate } = require('./middleware');
const { permissionsFor } = require('./admin-permissions');
const schemas = require('./validation');
const { SECTION_SCHEMAS } = require('./settings');
const { sendVerificationRequest } = require('./verification');
const whatsapp = require('./whatsapp');
const { generateReportPdf, formatInr } = require('./pdf');

const permit = permission => (req, _res, next) =>
  permissionsFor(req.user).includes(permission)
    ? next()
    : next(new AppError(403, 'ADMIN_PERMISSION_REQUIRED', 'Your account does not have permission for this admin action.'));

function adminRoutes() {
  const router = express.Router();

  router.get('/dashboard', permit('dashboard.read'), wrap(async (_req, res) => {
    const [users, dairies, customers, activeUsers, deliveries, openDisputes] = await Promise.all([
      User.countDocuments(),
      Milkman.countDocuments(),
      Customer.countDocuments(),
      User.countDocuments({ active: true }),
      Record.countDocuments({ deleted: false }),
      Dispute.countDocuments({ status: { $in: ['open', 'under_review'] } })
    ]);
    res.json({ success: true, data: { users, dairies, customers, activeUsers, deliveries, openDisputes } });
  }));

  const lists = [
    ['/users', 'users.read', User, 'name email role adminRole active createdAt'],
    ['/dairies', 'dairies.read', Milkman, 'businessName name phone verified subscription createdAt']
  ];

  for (const [path, permission, Model, fields] of lists) {
    router.get(path, permit(permission), wrap(async (req, res) => {
      const page = Number(req.query.page || 1), limit = 25;
      if (!Number.isInteger(page) || page < 1 || page > 10000) {
        throw new AppError(400, 'INVALID_PAGINATION', 'Page must be a positive integer up to 10000.');
      }
      const [data, total] = await Promise.all([
        Model.find().select(fields).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Model.countDocuments()
      ]);
      res.json({ success: true, data, meta: { total, page, limit } });
    }));
  }

  // Full account detail for one user: account fields plus the role-specific
  // profile (dairy business or customer service record), quick stats, and the
  // account's most recent audited actions.
  router.get('/users/:id', permit('users.read'), wrap(async (req, res) => {
    const user = await User.findById(req.params.id).select('name email role adminRole active createdAt milkman_id customer_id').lean();
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User was not found.');
    const detail = {
      _id: user._id, name: user.name, email: user.email, role: user.role, adminRole: user.adminRole,
      active: user.active, createdAt: user.createdAt, profile: null, stats: {}, recentActions: []
    };
    const recentActions = Audit.find({ actor: user._id }).select('action target createdAt').sort({ createdAt: -1 }).limit(5).lean();
    if (user.role === 'milkman' && user.milkman_id) {
      const [dairy, customers, deliveries, disputes, actions] = await Promise.all([
        Milkman.findById(user.milkman_id).lean(),
        Customer.countDocuments({ milkman_id: user.milkman_id }),
        Record.countDocuments({ milkman_id: user.milkman_id, deleted: false }),
        Dispute.countDocuments({ milkman_id: user.milkman_id }),
        recentActions
      ]);
      detail.profile = dairy ? {
        businessName: dairy.businessName, name: dairy.name, phone: dairy.phone, upiId: dairy.upiId,
        code: dairy.code, verified: dairy.verified, subscription: dairy.subscription, createdAt: dairy.createdAt
      } : null;
      detail.stats = { customers, deliveries, disputes };
      detail.recentActions = actions;
    } else if (user.role === 'customer' && user.customer_id) {
      const [customer, dairy, deliveries, disputes, actions] = await Promise.all([
        Customer.findById(user.customer_id).lean(),
        user.milkman_id ? Milkman.findById(user.milkman_id).select('businessName').lean() : null,
        Record.countDocuments({ customer_id: user.customer_id, deleted: false }),
        Dispute.countDocuments({ customer_id: user.customer_id }),
        recentActions
      ]);
      detail.profile = customer ? {
        name: customer.name, phone: customer.phone, address: customer.address, status: customer.status,
        startDate: customer.startDate, cowRatePaise: customer.cowRatePaise, buffaloRatePaise: customer.buffaloRatePaise,
        emailVerified: !!(customer.emailVerifiedAt || (customer.user_id && customer.email && customer.email === user.email)),
        phoneVerified: !!customer.phoneVerifiedAt,
        dairyName: dairy?.businessName || null
      } : null;
      detail.stats = { deliveries, disputes };
      detail.recentActions = actions;
    } else if (user.role === 'admin') {
      detail.recentActions = await recentActions;
    }
    res.json({ success: true, data: detail });
  }));

  // Activity log enriched with human details: who did it (resolved actor) and
  // what it touched (resolved target), so the console reads like a story of
  // the platform instead of raw ObjectIds.
  router.get('/activity', permit('audit.read'), wrap(async (req, res) => {
    const page = Number(req.query.page || 1), limit = 25;
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      throw new AppError(400, 'INVALID_PAGINATION', 'Page must be a positive integer up to 10000.');
    }
    const [rows, total] = await Promise.all([
      Audit.find().select('actor action target after milkman_id createdAt requestId').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Audit.countDocuments()
    ]);
    const looksLikeId = value => typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
    const actorIds = [...new Set(rows.map(r => r.actor).filter(Boolean).map(String))];
    const targetIds = [...new Set(rows.map(r => r.target).filter(looksLikeId))];
    const [actors, targetUsers, targetDairies, targetCustomers] = await Promise.all([
      actorIds.length ? User.find({ _id: { $in: actorIds } }).select('name email role adminRole').lean() : [],
      targetIds.length ? User.find({ _id: { $in: targetIds } }).select('name email role').lean() : [],
      targetIds.length ? Milkman.find({ _id: { $in: targetIds } }).select('businessName').lean() : [],
      targetIds.length ? Customer.find({ _id: { $in: targetIds } }).select('name').lean() : []
    ]);
    const byId = list => new Map(list.map(d => [String(d._id), d]));
    const actorMap = byId(actors), userMap = byId(targetUsers), dairyMap = byId(targetDairies), customerMap = byId(targetCustomers);
    const data = rows.map(r => {
      const actor = r.actor ? actorMap.get(String(r.actor)) : null;
      const targetDairy = dairyMap.get(String(r.target));
      const targetCustomer = customerMap.get(String(r.target));
      const targetUser = userMap.get(String(r.target));
      return {
        _id: r._id, action: r.action, target: r.target, after: r.after, createdAt: r.createdAt, requestId: r.requestId,
        actor: actor ? { name: actor.name, email: actor.email, role: actor.role, adminRole: actor.adminRole } : null,
        targetLabel: targetDairy?.businessName || targetCustomer?.name || targetUser?.email || null,
        targetType: targetDairy ? 'dairy' : targetCustomer ? 'customer' : targetUser ? 'user' : null
      };
    });
    res.json({ success: true, data, meta: { total, page, limit } });
  }));

  // Toggle user active status (FR-ADM-03: Last super_admin safeguard)
  router.patch('/users/:id/status', permit('users.manage'), validate(schemas.adminUserStatus), wrap(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User was not found.');

    if (user.role === 'admin' && user.adminRole === 'super_admin' && user.active && req.body.active === false) {
      const activeSuperAdmins = await User.countDocuments({ role: 'admin', adminRole: 'super_admin', active: true });
      if (activeSuperAdmins <= 1) {
        throw new AppError(409, 'LAST_SUPER_ADMIN', 'Cannot deactivate the last remaining super administrator account.');
      }
    }

    const before = { active: user.active };
    user.active = req.body.active;
    await user.save();

    await Audit.create([{
      actor: req.user._id,
      action: 'admin.user.status.updated',
      target: String(user._id),
      requestId: req.requestId,
      before,
      after: { active: user.active }
    }]);

    res.json({ success: true, data: { _id: user._id, active: user.active } });
  }));

  // Update user role / admin role (FR-ADM-03: Last super_admin safeguard)
  router.patch('/users/:id/role', permit('users.manage'), validate(schemas.adminUserRole), wrap(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User was not found.');

    const isCurrentlySuperAdmin = user.role === 'admin' && user.adminRole === 'super_admin' && user.active;
    const isLosingSuperAdmin = req.body.role !== 'admin' || req.body.adminRole !== 'super_admin';

    if (isCurrentlySuperAdmin && isLosingSuperAdmin) {
      const activeSuperAdmins = await User.countDocuments({ role: 'admin', adminRole: 'super_admin', active: true });
      if (activeSuperAdmins <= 1) {
        throw new AppError(409, 'LAST_SUPER_ADMIN', 'Cannot demote the last remaining super administrator account.');
      }
    }

    const before = { role: user.role, adminRole: user.adminRole };
    user.role = req.body.role;
    user.adminRole = req.body.role === 'admin' ? req.body.adminRole : undefined;
    await user.save();

    await Audit.create([{
      actor: req.user._id,
      action: 'admin.user.role.updated',
      target: String(user._id),
      requestId: req.requestId,
      before,
      after: { role: user.role, adminRole: user.adminRole }
    }]);

    res.json({ success: true, data: { _id: user._id, role: user.role, adminRole: user.adminRole } });
  }));

  // Ask a customer to verify their contact details: sends fresh codes for the
  // requested channels (email via SMTP, mobile number via WhatsApp) and adds an
  // in-app notification telling them where to enter the code.
  router.post('/users/:id/verification-request', permit('users.manage'), validate(schemas.verificationChannels), wrap(async (req, res) => {
    const user = await User.findById(req.params.id).select('name email role milkman_id customer_id').lean();
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User was not found.');
    if (user.role !== 'customer' || !user.customer_id) throw new AppError(409, 'NOT_A_CUSTOMER', 'Verification requests can only be sent to customer accounts.');
    const customer = await Customer.findById(user.customer_id).lean();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer profile was not found.');
    const data = await sendVerificationRequest(customer, user, req.body.channels);
    await Audit.create([{ actor: req.user._id, action: 'admin.customer.verification.requested', target: String(customer._id), requestId: req.requestId, before: null, after: data }]);
    res.json({ success: true, data });
  }));

  // Verify / unverify dairy
  router.patch('/dairies/:id/verify', permit('dairies.manage'), wrap(async (req, res) => {
    const dairy = await Milkman.findById(req.params.id);
    if (!dairy) throw new AppError(404, 'NOT_FOUND', 'Dairy was not found.');

    const before = { verified: dairy.verified };
    dairy.verified = typeof req.body.verified === 'boolean' ? req.body.verified : !dairy.verified;
    await dairy.save();

    await Audit.create([{
      actor: req.user._id,
      action: 'admin.dairy.verified.updated',
      target: String(dairy._id),
      requestId: req.requestId,
      before,
      after: { verified: dairy.verified }
    }]);

    res.json({ success: true, data: { _id: dairy._id, verified: dairy.verified } });
  }));

  // WhatsApp connection for free OTP and PDF delivery: one linked session per
  // deployment, started from this console either by scanning a QR code or by
  // typing the 8-character code WhatsApp offers under "Link with phone number
  // instead".
  router.get('/whatsapp/status', permit('settings.read'), wrap(async (_req, res) => res.json({ success: true, data: await whatsapp.status() })));
  router.post('/whatsapp/qr', permit('settings.manage'), wrap(async (_req, res) => {
    const qr = await whatsapp.getQr();
    if (!qr) throw new AppError(409, 'WHATSAPP_ALREADY_CONNECTED', 'WhatsApp is already connected.');
    res.json({ success: true, data: { qr } });
  }));
  router.post('/whatsapp/pairing-code', permit('settings.manage'), validate(schemas.whatsappPairing), wrap(async (req, res) => {
    const code = await whatsapp.getPairingCode(req.body.number);
    if (!code) throw new AppError(409, 'WHATSAPP_ALREADY_CONNECTED', 'WhatsApp is already connected.');
    res.json({ success: true, data: { code } });
  }));
  router.post('/whatsapp/disconnect', permit('settings.manage'), wrap(async (_req, res) => {
    await whatsapp.disconnect();
    res.json({ success: true, data: { message: 'WhatsApp has been disconnected.' } });
  }));

  // Platform dairy directory as a PDF (downloadable and shareable to WhatsApp).
  router.get('/dairies.pdf', permit('dairies.read'), wrap(async (_req, res) => {
    const dairies = await Milkman.find().select('businessName name phone code verified').sort({ createdAt: -1 }).lean();
    const [owners, counts] = await Promise.all([
      User.find({ role: 'milkman' }).select('email milkman_id').lean(),
      Customer.aggregate([{ $group: { _id: '$milkman_id', customers: { $sum: 1 } } }])
    ]);
    const ownerMap = new Map(owners.map(o => [String(o.milkman_id), o.email]));
    const countMap = new Map(counts.map(c => [String(c._id), c.customers]));
    const rows = dairies.map(d => [d.businessName || '-', ownerMap.get(String(d._id)) || '-', d.phone || '-', d.code || '-', d.verified ? 'Verified' : 'Pending', String(countMap.get(String(d._id)) || 0)]);
    const buffer = await generateReportPdf({
      title: 'Dairy directory',
      dairyName: 'GauAmrut platform',
      period: today(),
      subtitle: `${dairies.length} registered dairies`,
      columns: [
        { label: 'Dairy', width: 105 }, { label: 'Owner email', width: 135 }, { label: 'Phone', width: 85 },
        { label: 'Code', width: 70 }, { label: 'Status', width: 55 }, { label: 'Customers', width: 49, align: 'right' }
      ],
      rows,
      summary: [`${dairies.length} dairies on the platform`, `Total customers: ${[...countMap.values()].reduce((n, v) => n + v, 0)}`]
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="gauamrut-dairy-directory.pdf"');
    res.send(buffer);
  }));

  // Platform-wide Disputes
  router.get('/disputes', permit('disputes.read'), wrap(async (req, res) => {
    const page = Number(req.query.page || 1), limit = 25;
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      throw new AppError(400, 'INVALID_PAGINATION', 'Page must be a positive integer.');
    }

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;

    const [disputes, total] = await Promise.all([
      Dispute.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Dispute.countDocuments(filter)
    ]);

    const dairyIds = [...new Set(disputes.map(d => String(d.milkman_id)))];
    const customerIds = [...new Set(disputes.map(d => String(d.customer_id)))];

    const [dairies, customers] = await Promise.all([
      Milkman.find({ _id: { $in: dairyIds } }).select('businessName name').lean(),
      Customer.find({ _id: { $in: customerIds } }).select('name phone').lean()
    ]);

    const dairyMap = new Map(dairies.map(d => [String(d._id), d.businessName]));
    const custMap = new Map(customers.map(c => [String(c._id), c.name]));

    const enriched = disputes.map(d => ({
      ...d,
      dairyName: dairyMap.get(String(d.milkman_id)) || 'Dairy',
      customerName: custMap.get(String(d.customer_id)) || 'Customer'
    }));

    res.json({ success: true, data: enriched, meta: { total, page, limit } });
  }));

  router.patch('/disputes/:id', permit('disputes.manage'), validate(schemas.adminDispute), wrap(async (req, res) => {
    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) throw new AppError(404, 'NOT_FOUND', 'Dispute was not found.');

    const before = dispute.toObject();
    if (req.body.priority) dispute.priority = req.body.priority;
    if (req.body.assignedTo !== undefined) dispute.assignedTo = req.body.assignedTo;
    if (req.body.escalated !== undefined) dispute.escalated = req.body.escalated;
    if (req.body.status) dispute.status = req.body.status;
    if (req.body.resolutionNotes) dispute.resolutionNotes = req.body.resolutionNotes;

    await dispute.save();

    await Audit.create([{
      actor: req.user._id,
      action: 'admin.dispute.updated',
      target: String(dispute._id),
      requestId: req.requestId,
      before,
      after: dispute.toObject()
    }]);

    res.json({ success: true, data: dispute.toObject() });
  }));

  // Settings
  // Platform-wide reports. Admins (unlike dairies) span every tenant, so these
  // exports carry a dairy column and are scoped by the reporting month only.
  const csvCell = value => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const monthParam = req => {
    const month = req.query.month || today().slice(0, 7);
    if (schemas.month.validate(month).error) throw new AppError(400, 'INVALID_MONTH', 'Use YYYY-MM for the report month.');
    return month;
  };
  const sendCsv = (res, filename, rows) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(rows));
  };
  const sendPdf = (res, filename, payload) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(payload);
  };
  const REPORT_CAP = 5000;
  const guardSize = async (Model, filter) => {
    if (await Model.countDocuments(filter) > REPORT_CAP) {
      throw new AppError(422, 'EXPORT_TOO_LARGE', 'This release supports up to 5,000 rows per export. Choose a smaller report period.');
    }
  };

  // Deliveries across every dairy for a month.
  router.get('/reports/deliveries.csv', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deleted: false, date: { $gte: month + '-01', $lte: month + '-31' } };
    await guardSize(Record, filter);
    const [rows, dairies, customers] = await Promise.all([
      Record.find(filter).sort({ date: 1 }).lean(),
      Milkman.find().select('businessName').lean(),
      Customer.find().select('name').lean()
    ]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    sendCsv(res, `gauamrut-deliveries-${month}.csv`, [
      ['Report', 'Platform deliveries'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Date', 'Dairy', 'Customer', 'Shift', 'Milk type', 'Quantity ml', 'Rate paise/L', 'Total paise'],
      ...rows.map(r => [r.date, dairyName.get(String(r.milkman_id)) || 'Dairy', custName.get(String(r.customer_id)) || 'Customer', r.shift, r.type, r.quantityMl, r.ratePaise, r.totalPaise]),
      ['Total paise', '', '', '', '', '', '', rows.reduce((n, r) => n + r.totalPaise, 0)]
    ]);
  }));
  router.get('/reports/deliveries.pdf', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deleted: false, date: { $gte: month + '-01', $lte: month + '-31' } };
    await guardSize(Record, filter);
    const [rows, dairies, customers] = await Promise.all([
      Record.find(filter).sort({ date: 1 }).lean(),
      Milkman.find().select('businessName').lean(),
      Customer.find().select('name').lean()
    ]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    const cap = value => { const s = String(value || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
    const pdf = await generateReportPdf({
      title: 'Platform deliveries',
      dairyName: 'GauAmrut platform',
      period: month,
      subtitle: 'Every milk delivery recorded across all dairies for the selected month.',
      columns: [
        { label: 'Date', width: 68 }, { label: 'Dairy', width: 110 }, { label: 'Customer', width: 110 },
        { label: 'Shift', width: 52 }, { label: 'Milk type', width: 56 }, { label: 'Qty (L)', width: 48, align: 'right' },
        { label: 'Rate/L', width: 60, align: 'right' }, { label: 'Total', width: 61, align: 'right' }
      ],
      rows: rows.map(r => [r.date, dairyName.get(String(r.milkman_id)) || 'Dairy', custName.get(String(r.customer_id)) || 'Customer', cap(r.shift), cap(r.type), (r.quantityMl / 1000).toFixed(3), formatInr(r.ratePaise), formatInr(r.totalPaise)]),
      summary: [`${rows.length} delivery entries`, `Total charges: ${formatInr(rows.reduce((n, r) => n + r.totalPaise, 0))}`]
    });
    sendPdf(res, `gauamrut-deliveries-${month}.pdf`, pdf);
  }));

  // Payments across every dairy for a month.
  router.get('/reports/payments.csv', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deleted: false, createdAt: { $gte: new Date(month + '-01T00:00:00+05:30'), $lte: new Date(month + '-31T23:59:59+05:30') } };
    const payments = await Payment.find(filter).sort({ createdAt: 1 }).lean();
    const [dairies, customers] = await Promise.all([Milkman.find().select('businessName').lean(), Customer.find().select('name').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    sendCsv(res, `gauamrut-payments-${month}.csv`, [
      ['Report', 'Platform payments'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Date', 'Dairy', 'Customer', 'Mode', 'Reference', 'Amount paise', 'Reversed'],
      ...payments.map(p => [new Date(p.createdAt).toISOString().slice(0, 10), dairyName.get(String(p.milkman_id)) || 'Dairy', custName.get(String(p.customer_id)) || 'Customer', p.mode || 'cash', p.reference || '', p.amountPaise, p.reversed ? 'Yes' : 'No']),
      ['Total paise', '', '', '', '', payments.filter(p => !p.reversed).reduce((n, p) => n + p.amountPaise, 0), '']
    ]);
  }));
  router.get('/reports/payments.pdf', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deleted: false, createdAt: { $gte: new Date(month + '-01T00:00:00+05:30'), $lte: new Date(month + '-31T23:59:59+05:30') } };
    const payments = await Payment.find(filter).sort({ createdAt: 1 }).lean();
    const [dairies, customers] = await Promise.all([Milkman.find().select('businessName').lean(), Customer.find().select('name').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    const cap = value => { const s = String(value || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
    const pdf = await generateReportPdf({
      title: 'Platform payments',
      dairyName: 'GauAmrut platform',
      period: month,
      subtitle: 'Customer payments recorded across all dairies for the selected month.',
      columns: [
        { label: 'Date', width: 70 }, { label: 'Dairy', width: 120 }, { label: 'Customer', width: 120 },
        { label: 'Mode', width: 58 }, { label: 'Reference', width: 95 }, { label: 'Amount', width: 62, align: 'right' }
      ],
      rows: payments.map(p => [new Date(p.createdAt).toISOString().slice(0, 10), dairyName.get(String(p.milkman_id)) || 'Dairy', custName.get(String(p.customer_id)) || 'Customer', cap(p.mode), p.reference || '-', formatInr(p.amountPaise)]),
      summary: [`${payments.length} payments`, `Total collected: ${formatInr(payments.filter(p => !p.reversed).reduce((n, p) => n + p.amountPaise, 0))}`]
    });
    sendPdf(res, `gauamrut-payments-${month}.pdf`, pdf);
  }));

  // Bills across every dairy for a month (platform receivables).
  router.get('/reports/bills.csv', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const bills = await Bill.find({ month }).sort({ month: 1 }).lean();
    const [dairies, customers] = await Promise.all([Milkman.find().select('businessName').lean(), Customer.find().select('name').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    sendCsv(res, `gauamrut-bills-${month}.csv`, [
      ['Report', 'Platform bills'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Dairy', 'Customer', 'Opening paise', 'Charges paise', 'Paid paise', 'Closing paise'],
      ...bills.map(b => [dairyName.get(String(b.milkman_id)) || 'Dairy', custName.get(String(b.customer_id)) || 'Customer', b.openingPaise, b.chargesPaise, b.paidPaise, b.closingPaise]),
      ['Total closing paise', '', '', '', '', bills.reduce((n, b) => n + b.closingPaise, 0)]
    ]);
  }));
  router.get('/reports/bills.pdf', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const bills = await Bill.find({ month }).sort({ month: 1 }).lean();
    const [dairies, customers] = await Promise.all([Milkman.find().select('businessName').lean(), Customer.find().select('name').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    const inr = formatInr;
    const pdf = await generateReportPdf({
      title: 'Platform bills',
      dairyName: 'GauAmrut platform',
      period: month,
      subtitle: 'Customer bills raised across all dairies for the selected month.',
      columns: [
        { label: 'Dairy', width: 130 }, { label: 'Customer', width: 130 }, { label: 'Opening', width: 78, align: 'right' },
        { label: 'Charges', width: 78, align: 'right' }, { label: 'Paid', width: 78, align: 'right' }, { label: 'Closing', width: 78, align: 'right' }
      ],
      rows: bills.map(b => [dairyName.get(String(b.milkman_id)) || 'Dairy', custName.get(String(b.customer_id)) || 'Customer', inr(b.openingPaise), inr(b.chargesPaise), inr(b.paidPaise), inr(b.closingPaise)]),
      summary: [`${bills.length} bills`, `Total receivable: ${inr(bills.reduce((n, b) => n + b.closingPaise, 0))}`]
    });
    sendPdf(res, `gauamrut-bills-${month}.pdf`, pdf);
  }));

  // Store orders across every dairy for a month.
  router.get('/reports/orders.csv', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deliveryDate: { $gte: month + '-01', $lte: month + '-31' } };
    await guardSize(Order, filter);
    const [orders, dairies, customers] = await Promise.all([
      Order.find(filter).sort({ deliveryDate: 1 }).lean(),
      Milkman.find().select('businessName').lean(),
      Customer.find().select('name').lean()
    ]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    sendCsv(res, `gauamrut-orders-${month}.csv`, [
      ['Report', 'Platform orders'],
      ['Period', month],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Delivery date', 'Dairy', 'Customer', 'Status', 'Items', 'Total paise'],
      ...orders.map(o => [o.deliveryDate, dairyName.get(String(o.milkman_id)) || 'Dairy', custName.get(String(o.customer_id)) || 'Customer', o.status, (o.items || []).map(i => `${i.name} x${i.quantity}`).join('; '), o.totalPaise]),
      ['Total paise', '', '', '', '', orders.filter(o => o.status !== 'cancelled').reduce((n, o) => n + o.totalPaise, 0)]
    ]);
  }));
  router.get('/reports/orders.pdf', permit('reports.read'), wrap(async (req, res) => {
    const month = monthParam(req);
    const filter = { deliveryDate: { $gte: month + '-01', $lte: month + '-31' } };
    await guardSize(Order, filter);
    const [orders, dairies, customers] = await Promise.all([
      Order.find(filter).sort({ deliveryDate: 1 }).lean(),
      Milkman.find().select('businessName').lean(),
      Customer.find().select('name').lean()
    ]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const custName = new Map(customers.map(c => [String(c._id), c.name]));
    const cap = value => { const s = String(value || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
    const pdf = await generateReportPdf({
      title: 'Platform orders',
      dairyName: 'GauAmrut platform',
      period: month,
      subtitle: 'Store product orders placed across all dairies for the selected month.',
      columns: [
        { label: 'Date', width: 68 }, { label: 'Dairy', width: 110 }, { label: 'Customer', width: 110 },
        { label: 'Status', width: 62 }, { label: 'Items', width: 130 }, { label: 'Total', width: 53, align: 'right' }
      ],
      rows: orders.map(o => [o.deliveryDate, dairyName.get(String(o.milkman_id)) || 'Dairy', custName.get(String(o.customer_id)) || 'Customer', cap(o.status), (o.items || []).map(i => `${i.name} x${i.quantity}`).join('; '), formatInr(o.totalPaise)]),
      summary: [`${orders.length} orders`, `Total value: ${formatInr(orders.filter(o => o.status !== 'cancelled').reduce((n, o) => n + o.totalPaise, 0))}`]
    });
    sendPdf(res, `gauamrut-orders-${month}.pdf`, pdf);
  }));

  // Customer directory with till-date outstanding across every dairy.
  router.get('/reports/customers.csv', permit('reports.read'), wrap(async (_req, res) => {
    const [customers, dairies] = await Promise.all([Customer.find().sort({ name: 1 }).lean(), Milkman.find().select('businessName').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const outstanding = await Payment.aggregate([
      { $match: { deleted: false, reversed: false } },
      { $group: { _id: { dairy: '$milkman_id', customer: '$customer_id' }, paidPaise: { $sum: '$amountPaise' } } }
    ]);
    const charges = await Record.aggregate([
      { $match: { deleted: false } },
      { $group: { _id: { dairy: '$milkman_id', customer: '$customer_id' }, totalPaise: { $sum: '$totalPaise' } } }
    ]);
    const paidMap = new Map(outstanding.map(o => [`${o._id.dairy}|${o._id.customer}`, o.paidPaise]));
    const chargeMap = new Map(charges.map(c => [`${c._id.dairy}|${c._id.customer}`, c.totalPaise]));
    sendCsv(res, 'gauamrut-customers.csv', [
      ['Report', 'Platform customers'],
      ['Generated', new Date().toISOString()],
      ['Currency', 'INR'],
      ['Dairy', 'Customer', 'Phone', 'Address', 'Status', 'Cow rate paise/L', 'Buffalo rate paise/L', 'Milk charges paise', 'Paid paise', 'Outstanding paise'],
      ...customers.map(c => {
        const key = `${c.milkman_id}|${c._id}`;
        const due = (chargeMap.get(key) || 0) - (paidMap.get(key) || 0);
        return [dairyName.get(String(c.milkman_id)) || 'Dairy', c.name, c.phone || '', c.address || '', c.status, c.cowRatePaise, c.buffaloRatePaise, chargeMap.get(key) || 0, paidMap.get(key) || 0, due];
      })
    ]);
  }));
  router.get('/reports/customers.pdf', permit('reports.read'), wrap(async (_req, res) => {
    const [customers, dairies] = await Promise.all([Customer.find().sort({ name: 1 }).lean(), Milkman.find().select('businessName').lean()]);
    const dairyName = new Map(dairies.map(d => [String(d._id), d.businessName || 'Dairy']));
    const [outstanding, charges] = await Promise.all([
      Payment.aggregate([{ $match: { deleted: false, reversed: false } }, { $group: { _id: { dairy: '$milkman_id', customer: '$customer_id' }, paidPaise: { $sum: '$amountPaise' } } }]),
      Record.aggregate([{ $match: { deleted: false } }, { $group: { _id: { dairy: '$milkman_id', customer: '$customer_id' }, totalPaise: { $sum: '$totalPaise' } } }])
    ]);
    const paidMap = new Map(outstanding.map(o => [`${o._id.dairy}|${o._id.customer}`, o.paidPaise]));
    const chargeMap = new Map(charges.map(c => [`${c._id.dairy}|${c._id.customer}`, c.totalPaise]));
    const inr = formatInr;
    const pdf = await generateReportPdf({
      title: 'Platform customers',
      dairyName: 'GauAmrut platform',
      subtitle: 'Every registered customer across all dairies, with till-date account balances.',
      columns: [
        { label: 'Dairy', width: 105 }, { label: 'Customer', width: 95 }, { label: 'Phone', width: 80 },
        { label: 'Address', width: 110 }, { label: 'Status', width: 50 }, { label: 'Cow Rs/L', width: 52, align: 'right' },
        { label: 'Buffalo Rs/L', width: 55, align: 'right' }, { label: 'Outstanding', width: 56, align: 'right' }
      ],
      rows: customers.map(c => {
        const key = `${c.milkman_id}|${c._id}`;
        return [dairyName.get(String(c.milkman_id)) || 'Dairy', c.name, c.phone || '-', c.address || '-', c.status, inr(c.cowRatePaise), inr(c.buffaloRatePaise), inr((chargeMap.get(key) || 0) - (paidMap.get(key) || 0))];
      }),
      summary: [`${customers.length} customers`, `Total outstanding: ${inr(customers.reduce((n, c) => { const key = `${c.milkman_id}|${c._id}`; return n + (chargeMap.get(key) || 0) - (paidMap.get(key) || 0); }, 0))}`]
    });
    sendPdf(res, 'gauamrut-customers.pdf', pdf);
  }));

  router.get('/settings', permit('settings.read'), wrap(async (_req, res) => {
    const settings = await AdminSetting.find().select('section payload version updatedAt updatedBy').lean();
    const updaterIds = [...new Set(settings.map(s => s.updatedBy).filter(Boolean).map(String))];
    const updaters = updaterIds.length ? await User.find({ _id: { $in: updaterIds } }).select('name email').lean() : [];
    const byId = new Map(updaters.map(u => [String(u._id), u]));
    res.json({
      success: true,
      data: settings.map(s => ({
        ...s,
        updatedByName: s.updatedBy ? byId.get(String(s.updatedBy))?.name || null : null
      }))
    });
  }));

  router.put('/settings/:section', permit('settings.manage'), validate(schemas.adminSetting), wrap(async (req, res) => {
    const section = String(req.params.section).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,30}$/.test(section)) {
      throw new AppError(400, 'INVALID_SETTINGS_SECTION', 'Settings sections use lowercase letters, digits, dashes, and underscores only.');
    }
    // Known sections are validated field by field; unknown sections keep
    // accepting a generic object so new groups can be introduced safely.
    let payload = req.body.payload;
    const schema = SECTION_SCHEMAS[section];
    if (schema) {
      const { value, error } = schema.validate(payload, { abortEarly: false, convert: false });
      if (error) throw new AppError(400, 'VALIDATION_ERROR', error.details[0].message);
      payload = value;
    }
    const existing = await AdminSetting.findOne({ section });
    const before = existing ? existing.payload : null;
    const version = existing ? existing.version + 1 : 1;

    const setting = await AdminSetting.findOneAndUpdate(
      { section },
      { payload, version, updatedBy: req.user._id },
      { upsert: true, new: true }
    );

    await Audit.create([{
      actor: req.user._id,
      action: `admin.setting.${section}.updated`,
      target: section,
      requestId: req.requestId,
      before,
      after: setting.payload
    }]);

    res.json({ success: true, data: setting.toObject() });
  }));

  return router;
}

module.exports = { adminRoutes };
