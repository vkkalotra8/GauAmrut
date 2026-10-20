require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Audit } = require('./models');
let localMongoChild = null;
async function bootstrap() {
  if (process.env.NODE_ENV !== 'development') throw new Error('This bootstrap command is for the local development database only.');
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), password = process.env.ADMIN_PASSWORD;
  if (!email.includes('@') || !password || password.length < 8 || Buffer.byteLength(password) > 72) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8 characters minimum, 72 bytes maximum).');
  const { ensureLocalMongo } = require('./local-mongo');
  localMongoChild = await ensureLocalMongo();
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User.init(), Audit.init()]);
  const existing = await User.findOne({ email }).select('+password');
  if (existing) {
    if (existing.role !== 'admin' || existing.adminRole !== 'super_admin' || !existing.active || !await bcrypt.compare(password, existing.password)) throw new Error('An account already exists with different access or credentials. No account was changed.');
    console.log('The requested admin account already exists and its credentials match.'); return;
  }
  const session = await mongoose.startSession();
  try {
    const hash = await bcrypt.hash(password, 12);
    await session.withTransaction(async () => {
      const [user] = await User.create([{ email, password: hash, name: 'GauAmrut Admin', role: 'admin', adminRole: 'super_admin', active: true }], { session });
      await Audit.create([{ actor: user._id, action: 'admin.bootstrapped', target: String(user._id), requestId: 'local-bootstrap' }], { session });
    });
    console.log('Local super-admin account created successfully.');
  } finally { await session.endSession(); }
}
bootstrap().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (localMongoChild) {
    try { localMongoChild.kill('SIGINT'); } catch {}
  }
});
