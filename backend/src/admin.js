const express = require('express');
const { User, Milkman, Customer, Record, Audit, Dispute, AdminSetting } = require('./models');
const { AppError, today } = require('./domain');
const { wrap, validate } = require('./middleware');
const { permissionsFor } = require('./admin-permissions');
const schemas = require('./validation');
const { SECTION_SCHEMAS } = require('./settings');
const { sendVerificationRequest } = require('./verification');
const whatsapp = require('./whatsapp');
const { generateReportPdf } = require('./pdf');

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
  // deployment, started by scanning a QR code from this console.
  router.get('/whatsapp/status', permit('settings.read'), wrap(async (_req, res) => res.json({ success: true, data: await whatsapp.status() })));
  router.post('/whatsapp/qr', permit('settings.manage'), wrap(async (_req, res) => {
    const qr = await whatsapp.getQr();
    if (!qr) throw new AppError(409, 'WHATSAPP_ALREADY_CONNECTED', 'WhatsApp is already connected.');
    res.json({ success: true, data: { qr } });
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
