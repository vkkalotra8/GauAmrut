require('dotenv').config();
const mongoose = require('mongoose');
const { migrations } = require('./migrations');

async function pendingMigrations() {
  const applied = await mongoose.connection.collection('migrations').find({}, { projection: { name: 1, checksum: 1 } }).toArray();
  const byName = new Map(applied.map(item => [item.name, item]));
  for (const migration of migrations) {
    const existing = byName.get(migration.name);
    if (existing && existing.checksum !== migration.checksum) throw new Error(`Applied migration ${migration.name} has changed checksum.`);
  }
  return migrations.filter(migration => !byName.has(migration.name));
}

async function assertMigrationsCurrent() {
  const pending = await pendingMigrations();
  if (pending.length) throw new Error(`Pending database migrations: ${pending.map(item => item.name).join(', ')}. Run npm run migrate before starting production.`);
}

async function runMigrations({ dryRun = false } = {}) {
  const pending = await pendingMigrations();
  const results = [];
  for (const migration of pending) {
    const started = Date.now();
    const result = await migration.up({ connection: mongoose.connection, dryRun });
    results.push({ name: migration.name, ...result });
    if (!dryRun) await mongoose.connection.collection('migrations').insertOne({ name: migration.name, checksum: migration.checksum, appliedAt: new Date(), executionMs: Date.now() - started });
  }
  return results;
}

async function cli() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
  mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const dryRun = process.argv.includes('--dry-run');
    console.log(JSON.stringify({ success: true, dryRun, results: await runMigrations({ dryRun }) }, null, 2));
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) cli().catch(error => {
  console.error(JSON.stringify({ success: false, code: error.code, message: error.message, details: error.details }, null, 2));
  process.exit(1);
});
module.exports = { pendingMigrations, assertMigrationsCurrent, runMigrations };
