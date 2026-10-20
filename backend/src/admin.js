const express = require('express');
const { User, Milkman, Customer, Record, Audit, Dispute, AdminSetting } = require('./models');
const { AppError } = require('./domain');
const { wrap, validate } = require('./middleware');
const { permissionsFor } = require('./admin-permissions');
const schemas = require('./validation');

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
    ['/dairies', 'dairies.read', Milkman, 'businessName name phone verified subscription createdAt'],
    ['/activity', 'audit.read', Audit, 'actor action target milkman_id createdAt requestId']
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
    const settings = await AdminSetting.find().lean();
    res.json({ success: true, data: settings });
  }));

  router.put('/settings/:section', permit('settings.manage'), validate(schemas.adminSetting), wrap(async (req, res) => {
    const section = req.params.section.toLowerCase();
    const existing = await AdminSetting.findOne({ section });
    const before = existing ? existing.payload : null;
    const version = existing ? existing.version + 1 : 1;

    const setting = await AdminSetting.findOneAndUpdate(
      { section },
      { payload: req.body.payload, version, updatedBy: req.user._id },
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
