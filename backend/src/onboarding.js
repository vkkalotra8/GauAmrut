const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, Milkman, Customer, Onboarding, Audit } = require('./models');
const { AppError, today } = require('./domain');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function resolveDairy(code, session = null) {
  const dairy = await Milkman.findOne({ code: code.toUpperCase() }).session(session);
  if (!dairy || !await User.exists({ _id: dairy.user_id, active: true, role: 'milkman' }).session(session)) throw new AppError(404, 'DAIRY_NOT_FOUND', 'This dairy code is no longer valid. Ask your milkman for the current code.');
  return dairy;
}
async function beginOnboarding(registration, session) {
  const dairy = await resolveDairy(registration.code, session);
  if (String(dairy._id) !== String(registration.milkman_id)) throw new AppError(409, 'DAIRY_CHANGED', 'Dairy code changed. Please start registration again.');
  const onboardingToken = crypto.randomBytes(32).toString('hex');
  await Onboarding.create([{ tokenHash: digest(onboardingToken), registration, expiry: new Date(Date.now() + 10 * 60000) }], { session });
  // Contact matching is offered only after verifying control of that exact email.
  const historyCandidates = await Customer.find({ milkman_id: dairy._id, email: registration.email, user_id: { $exists: false } }).select('_id name startDate').limit(20).session(session).lean();
  return { onboardingRequired: true, onboardingToken, businessName: dairy.businessName, historyCandidates };
}
async function completeOnboarding(body, requestId) {
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const pending = await Onboarding.findOneAndDelete({ tokenHash: digest(body.onboardingToken), expiry: { $gt: new Date() } }).select('+registration').session(session);
      if (!pending) throw new AppError(400, 'ONBOARDING_EXPIRED', 'This onboarding session expired or was already used. Start registration again.');
      const r = pending.registration, dairy = await resolveDairy(r.code, session);
      if (String(dairy._id) !== String(r.milkman_id)) throw new AppError(409, 'DAIRY_CHANGED', 'Dairy code changed. Start registration again.');
      // Serialize completion with code regeneration and other onboarding for this dairy.
      await Milkman.updateOne({ _id: dairy._id }, { $inc: { __v: 1 } }, { session });
      const userId = new mongoose.Types.ObjectId();
      let customer;
      if (body.claimCustomerId) {
        customer = await Customer.findOneAndUpdate({ _id: body.claimCustomerId, milkman_id: dairy._id, email: r.email, user_id: { $exists: false } }, { $set: { user_id: userId, language: r.language } }, { new: true, session });
        if (!customer) throw new AppError(409, 'CLAIM_UNAVAILABLE', 'This history cannot be claimed by this account. Ask your dairy to check the email and existing linkage.');
      } else {
        [customer] = await Customer.create([{ milkman_id: dairy._id, user_id: userId, name: r.name, email: r.email, phone: r.phone, address: r.address, language: r.language, status: 'inactive', startDate: today(), cowRatePaise: 0, buffaloRatePaise: 0, morningCowMl: 0, eveningCowMl: 0, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: 0, routeEvening: 0 }], { session });
      }
      [user] = await User.create([{ _id: userId, email: r.email, password: r.password, role: 'customer', milkman_id: dairy._id, customer_id: customer._id, name: customer.name }], { session });
      await Audit.create([{ milkman_id: dairy._id, actor: userId, action: body.claimCustomerId ? 'customer.history.claimed' : 'customer.registered', target: String(customer._id), requestId }], { session });
    });
    return user;
  } finally { await session.endSession(); }
}
module.exports = { resolveDairy, beginOnboarding, completeOnboarding };
