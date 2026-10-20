const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const mongoose = require('../backend/node_modules/mongoose');
const { MongoMemoryReplSet } = require('../backend/node_modules/mongodb-memory-server');
const { createApp } = require('../backend/src/app');
async function main() {
  process.env.NODE_ENV = 'development'; process.env.DEV_SHOW_OTP = 'true';
  process.env.JWT_SECRET = randomBytes(48).toString('hex'); process.env.CORS_ORIGINS = 'http://127.0.0.1:5174';
  let systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
  if (!systemBinary) { try { systemBinary = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['mongod'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]; } catch {} }
  const replica = await MongoMemoryReplSet.create({ binary: { ...(systemBinary ? { systemBinary } : {}), version: '8.0.28' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri('gauamrut_e2e'));
  await Promise.all(Object.values(require('../backend/src/models')).map(m => m.init()));
  await require('../backend/src/models').User.create({ name: 'E2E Admin', email: 'admin-e2e@example.com', password: await require('../backend/node_modules/bcryptjs').hash('e2e-admin-password', 4), role: 'admin', adminRole: 'super_admin' });
  const server = createApp().listen(4001, '127.0.0.1');
  const stop = () => server.close(async () => { await mongoose.disconnect(); await replica.stop(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch(error => { console.error(error.message); process.exit(1); });
