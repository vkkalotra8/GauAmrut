const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { User, Milkman, Customer, Audit } = require('./models');
const { AppError } = require('./domain');
const { wrap, vendor, validate } = require('./middleware');
const schemas = require('./validation');
async function change(req, action, operation) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const { before, after, target } = await operation(session);
      await Audit.create([{ milkman_id: req.tenant, actor: req.user._id, action, target: String(target), requestId: req.requestId, before, after }], { session });
      result = after;
    });
    return result;
  } finally { await session.endSession(); }
}
function accountsRoutes() {
  const router = express.Router();
  router.get('/profile', wrap(async (req, res) => {
    const profile = req.user.role === 'customer' ? await Customer.findOne({ _id: req.user.customer_id, milkman_id: req.tenant }).lean() : await Milkman.findOne({ _id: req.tenant, user_id: req.user._id }).lean();
    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Profile was not found.');
    res.json({ success: true, data: profile });
  }));
  router.patch('/profile', wrap(async (req, res) => {
    if (req.user.role === 'customer') {
      const { value, error } = schemas.selfProfile.validate(req.body, { abortEarly: true, convert: false });
      if (error) throw new AppError(400, 'VALIDATION_ERROR', error.details[0].message);
      const data = await change(req, 'customer.profile.updated', async session => {
        const profile = await Customer.findOne({ _id: req.user.customer_id, milkman_id: req.tenant }).session(session);
        if (!profile) throw new AppError(404, 'NOT_FOUND', 'Profile was not found.');
        const before = { name: profile.name, address: profile.address, language: profile.language };
        Object.assign(profile, value); await profile.save({ session });
        await User.updateOne({ _id: req.user._id }, { name: profile.name }, { session });
        return { before, after: profile.toObject(), target: profile._id };
      });
      return res.json({ success: true, data });
    }
    if (req.user.role === 'milkman') {
      const { value, error } = schemas.vendorProfile.validate(req.body, { abortEarly: true, convert: false });
      if (error) throw new AppError(400, 'VALIDATION_ERROR', error.details[0].message);
      const data = await change(req, 'milkman.profile.updated', async session => {
        const profile = await Milkman.findOne({ _id: req.tenant, user_id: req.user._id }).session(session);
        if (!profile) throw new AppError(404, 'NOT_FOUND', 'Dairy was not found.');
        const before = { businessName: profile.businessName, name: profile.name, phone: profile.phone, upiId: profile.upiId };
        Object.assign(profile, value); await profile.save({ session });
        await User.updateOne({ _id: req.user._id }, { name: profile.name }, { session });
        return { before, after: profile.toObject(), target: profile._id };
      });
      return res.json({ success: true, data });
    }
    throw new AppError(403, 'FORBIDDEN', 'This profile form is for dairy or customer accounts.');
  }));
  router.put('/customers/:id', vendor, validate(schemas.customer.keys({ status: schemas.Joi.string().valid('active', 'inactive').required() })), wrap(async (req, res) => {
    if (req.body.endDate && req.body.endDate < req.body.startDate) throw new AppError(400, 'INVALID_DATES', 'End date must be on or after start date.');
    const data = await change(req, 'customer.updated', async session => {
      const profile = await Customer.findOne({ _id: req.params.id, milkman_id: req.tenant }).session(session);
      if (!profile) throw new AppError(404, 'NOT_FOUND', 'Customer was not found.');
      const email = req.body.email.toLowerCase().trim();
      if (profile.user_id && email !== profile.email) throw new AppError(409, 'VERIFIED_EMAIL_LOCKED', 'A linked account’s verified email cannot be changed by the dairy.');
      const before = profile.toObject();
      Object.assign(profile, req.body, { email }); await profile.save({ session });
      if (profile.user_id) await User.updateOne({ _id: profile.user_id }, { name: profile.name }, { session });
      return { before, after: profile.toObject(), target: profile._id };
    });
    res.json({ success: true, data });
  }));
  router.patch('/customers/route-order', vendor, validate(schemas.routeOrder), wrap(async (req, res) => {
    const { shift, orders } = req.body;
    const ids = orders.map(o => o.customer_id);
    await change(req, 'customer.routes.reordered', async session => {
      const customers = await Customer.find({ _id: { $in: ids }, milkman_id: req.tenant }).session(session);
      if (customers.length !== ids.length) throw new AppError(404, 'NOT_FOUND', 'One or more customers were not found in your dairy.');
      const field = shift === 'evening' ? 'routeEvening' : 'routeMorning';
      for (const item of orders) {
        await Customer.updateOne({ _id: item.customer_id, milkman_id: req.tenant }, { [field]: item.order }, { session });
      }
      return { before: { shift, count: orders.length }, after: { shift, count: orders.length, orders }, target: shift };
    });
    res.json({ success: true, data: { updated: true, shift, count: orders.length } });
  }));
  router.post('/profile/code', vendor, wrap(async (req, res) => {
    let data;
    // A unique index and transaction protect collisions; retry a generated collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        data = await change(req, 'milkman.code.regenerated', async session => {
          const profile = await Milkman.findOne({ _id: req.tenant, user_id: req.user._id }).session(session);
          if (!profile) throw new AppError(404, 'NOT_FOUND', 'Dairy was not found.');
          const before = { code: profile.code }; profile.code = crypto.randomBytes(4).toString('hex').toUpperCase();
          await profile.save({ session });
          return { before, after: { code: profile.code }, target: profile._id };
        });
        break;
      } catch (error) { if (error.code !== 11000 || attempt === 4) throw error; }
    }
    res.json({ success: true, data });
  }));
  return router;
}
module.exports = { accountsRoutes, change };
