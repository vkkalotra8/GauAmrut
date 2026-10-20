require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('redis');
const { createApp } = require('./app');
async function start() {
  for (const key of ['MONGO_URI', 'JWT_SECRET', 'CORS_ORIGINS']) if (!process.env[key]) throw new Error(`Missing ${key}`);
  if (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-')) throw new Error('Set a random JWT_SECRET of at least 32 characters.');
  if (process.env.NODE_ENV === 'production' && (!process.env.REDIS_URL || !process.env.SMTP_HOST || process.env.DEV_SHOW_OTP === 'true')) throw new Error('Production requires Redis, SMTP, and disabled development OTP visibility.');
  const { ensureLocalMongo } = require('./local-mongo');
  const localMongoChild = await ensureLocalMongo();
  await mongoose.connect(process.env.MONGO_URI);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('MongoDB must run as a replica set.');
  await Promise.all(Object.values(require('./models')).map(m => m.init()));
  const redis = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
  if (redis) { redis.on('error', () => console.error(JSON.stringify({ event: 'redis_error' }))); await redis.connect(); }
  const port = process.env.PORT || 4000;
  const server = createApp(redis).listen(port, '0.0.0.0');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    await mongoose.disconnect();
    if (redis) await redis.quit();
    if (localMongoChild) {
      try { localMongoChild.kill('SIGINT'); } catch {}
    }
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. GauAmrut may already be running. Check http://127.0.0.1:${port}/api/health. Stop the existing backend with Ctrl+C before running npm start again. Start the frontend separately with npm run dev in the frontend directory.`);
    throw error;
  }
  console.log(`GauAmrut API is ready on port ${port}.`);

  const cron = require('node-cron');
  const { runMonthlyBillingScheduler } = require('./billing-scheduler');
  const cronSchedule = process.env.BILLING_CRON_SCHEDULE || '5 0 1 * *';
  const cronJob = cron.schedule(cronSchedule, async () => {
    try {
      console.log(JSON.stringify({ event: 'monthly_billing_cron_triggered', time: new Date().toISOString() }));
      const result = await runMonthlyBillingScheduler();
      console.log(JSON.stringify({ event: 'monthly_billing_cron_completed', result }));
    } catch (err) {
      console.error(JSON.stringify({ event: 'monthly_billing_cron_failed', error: err.message }));
    }
  }, { timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });

  const shutdown = () => {
    cronJob.stop();
    server.close(async () => {
      await mongoose.disconnect();
      if (redis) await redis.quit();
      if (localMongoChild) {
        try { localMongoChild.kill('SIGINT'); } catch {}
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
start().catch(error => { console.error(error.message); process.exit(1); });
