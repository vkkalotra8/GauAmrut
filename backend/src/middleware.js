const jwt = require('jsonwebtoken');
const { User, Customer } = require('./models');
const { AppError } = require('./domain');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const validate = schema => (req, _res, next) => {
  const { value, error } = schema.validate(req.body, { abortEarly: true, convert: false });
  if (error) return next(new AppError(400, 'VALIDATION_ERROR', error.details[0].message));
  req.body = value; next();
};
const auth = wrap(async (req, _res, next) => {
  let payload;
  try { payload = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'gauamrut' }); }
  catch { throw new AppError(401, 'UNAUTHORIZED', 'Please sign in to continue.'); }
  const user = await User.findById(payload.sub).select('+sessionVersion');
  if (!user || !user.active || (payload.sv || 0) !== (user.sessionVersion || 0)) throw new AppError(401, 'UNAUTHORIZED', 'Your session is no longer active.');
  if (user.role === 'customer' && (!user.customer_id || !await Customer.exists({ _id: user.customer_id, user_id: user._id, milkman_id: user.milkman_id }))) throw new AppError(403, 'PROFILE_UNLINKED', 'Your customer profile is no longer linked. Contact your dairy.');
  req.user = user; req.tenant = user.milkman_id; next();
});
const vendor = (req, _res, next) => req.user.role === 'milkman' ? next() : next(new AppError(403, 'FORBIDDEN', 'This action requires a milkman account.'));
const scope = req => ({ milkman_id: req.tenant, ...(req.user.role === 'customer' ? { customer_id: req.user.customer_id } : {}) });
module.exports = { wrap, validate, auth, vendor, scope };
