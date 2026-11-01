require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Milkman, Customer, Record } = require('./models');
const { today, charge } = require('./domain');
let localMongoChild = null;
async function seed() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Sample data can only be created in development.');
  if (!process.env.SEED_PASSWORD || process.env.SEED_PASSWORD.length < 8) throw new Error('Set SEED_PASSWORD (at least 8 characters) before running the seed command.');
  const { ensureLocalMongo } = require('./local-mongo');
  localMongoChild = await ensureLocalMongo();
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all(Object.values(require('./models')).map(m => m.init()));
  const email = 'owner@gauamrut.local';
  if (await User.exists({ email })) { console.log('Sample account already exists. Existing data was preserved.'); return; }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const milkman_id = new mongoose.Types.ObjectId();
      const [user] = await User.create([{ email, password: await bcrypt.hash(process.env.SEED_PASSWORD, 12), name: 'Aarav Patel', role: 'milkman', milkman_id }], { session });
      await Milkman.create([{ _id: milkman_id, user_id: user._id, name: user.name, businessName: 'Shree Krishna Dairy', code: 'SAMPLE01' }], { session });
      const names = ['Meera Shah', 'Rajesh Patel', 'Priya Desai', 'Amit Joshi', 'Kavita Mehta', 'Rohan Trivedi', 'Nisha Parmar', 'Suresh Shah'];
      for (let i = 0; i < names.length; i++) {
        const [customer] = await Customer.create([{ milkman_id, name: names[i], phone: '9876543210', address: `${i + 1}, Sample Society`, startDate: today().slice(0, 4) + '-01-01', cowRatePaise: 6000, buffaloRatePaise: 8000, morningCowMl: i % 3 === 0 ? 1500 : 1000, eveningCowMl: 500, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: i, routeEvening: i }], { session });
        for (let day = 1; day <= Math.min(Number(today().slice(-2)), 7); day++) {
          const date = today().slice(0, 7) + '-' + String(day).padStart(2, '0');
          await Record.create([{ milkman_id, customer_id: customer._id, date, shift: 'morning', type: 'cow', quantityMl: customer.morningCowMl, ratePaise: customer.cowRatePaise, totalPaise: charge(customer.morningCowMl, customer.cowRatePaise) }], { session });
        }
      }
    });
    console.log('Created development account owner@gauamrut.local using your SEED_PASSWORD.');
  } finally { await session.endSession(); }
}
seed().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (localMongoChild) {
    try { localMongoChild.kill('SIGINT'); } catch {}
  }
});
