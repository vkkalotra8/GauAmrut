const crypto = require('crypto');
const mongoose = require('mongoose');
const { DistributedLock, Milkman, Customer, Bill, Record, Audit } = require('./models');
const { AppError, today } = require('./domain');

async function acquireLock(lockKey, leaseMs = 60000, workerId = crypto.randomUUID()) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);
  try {
    await DistributedLock.create([{ _id: lockKey, lockedBy: workerId, lockedAt: now, expiresAt }]);
    return { acquired: true, workerId };
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const acquired = await DistributedLock.findOneAndUpdate(
    { _id: lockKey, expiresAt: { $lt: now } },
    { $set: { lockedBy: workerId, lockedAt: now, expiresAt } },
    { new: true }
  );
  return { acquired: !!acquired, workerId };
}

async function releaseLock(lockKey, workerId) {
  await DistributedLock.deleteOne({ _id: lockKey, lockedBy: workerId });
}

function getPreviousMonth(referenceDate = today()) {
  const year = parseInt(referenceDate.slice(0, 4), 10);
  const month = parseInt(referenceDate.slice(5, 7), 10);
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

async function runMonthlyBillingScheduler({ month, milkmanId, workerId = crypto.randomUUID(), actorId } = {}) {
  const targetMonth = month || getPreviousMonth();
  if (targetMonth >= today().slice(0, 7)) {
    throw new AppError(409, 'MONTH_OPEN', 'Bills can be finalized only after the month ends.');
  }

  const lockKey = `billing_scheduler_${milkmanId ? milkmanId + '_' : ''}${targetMonth}`;
  const lock = await acquireLock(lockKey, 120000, workerId);
  if (!lock.acquired) {
    throw new AppError(409, 'SCHEDULER_LOCKED', 'Monthly billing scheduler is already executing for this period.');
  }

  const summary = { targetMonth, generated: 0, skipped: 0, errors: [] };

  try {
    const milkmen = milkmanId
      ? await Milkman.find({ _id: milkmanId }).lean()
      : await Milkman.find().lean();

    for (const m of milkmen) {
      const customers = await Customer.find({ milkman_id: m._id, status: 'active' });

      for (const c of customers) {
        try {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              const existing = await Bill.findOne({ milkman_id: m._id, customer_id: c._id, month: targetMonth }).session(session);
              if (existing) {
                summary.skipped += 1;
                return;
              }

              // Verify customer version lock
              await Customer.updateOne({ _id: c._id }, { $inc: { __v: 1 } }, { session });

              // Carry forward from previous bill or customer initial opening balance
              const previous = await Bill.findOne({ milkman_id: m._id, customer_id: c._id, month: { $lt: targetMonth } }).sort({ month: -1 }).session(session);
              const openingPaise = previous ? previous.closingPaise : (c.openingBalancePaise || 0);

              const records = await Record.find({ milkman_id: m._id, customer_id: c._id, deleted: false, date: { $gte: `${targetMonth}-01`, $lte: `${targetMonth}-31` } }).session(session);
              const chargesPaise = records.reduce((sum, r) => sum + r.totalPaise, 0);

              // Only generate if customer had deliveries or carries an opening debt
              if (chargesPaise === 0 && openingPaise === 0) {
                summary.skipped += 1;
                return;
              }

              const closingPaise = openingPaise + chargesPaise;
              await Bill.create([{
                milkman_id: m._id,
                customer_id: c._id,
                month: targetMonth,
                openingPaise,
                chargesPaise,
                paidPaise: 0,
                closingPaise
              }], { session });

              summary.generated += 1;
            });
          } finally {
            await session.endSession();
          }
        } catch (custErr) {
          summary.errors.push({ customer_id: c._id, message: custErr.message });
        }
      }

      if (actorId) {
        await Audit.create([{
          milkman_id: m._id,
          actor: actorId,
          action: 'billing.scheduler.run',
          target: targetMonth,
          after: { generated: summary.generated, skipped: summary.skipped, month: targetMonth }
        }]);
      }
    }

    return summary;
  } finally {
    await releaseLock(lockKey, workerId);
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  getPreviousMonth,
  runMonthlyBillingScheduler
};
