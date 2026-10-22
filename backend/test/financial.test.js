const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const models = require('../src/models');
const { createApp } = require('../src/app');
const { today } = require('../src/domain');
const { acquireLock, releaseLock } = require('../src/billing-scheduler');

let replica, app, ownerA, tokenA, customerUserA, customerTokenA, customerDocA;

const customerFields = {
  name: 'Kavita Patel',
  phone: '9876543210',
  address: 'Sector 15, Gandhinagar',
  startDate: '2025-01-01',
  cowRatePaise: 6000,
  buffaloRatePaise: 8000,
  morningCowMl: 1000,
  eveningCowMl: 0,
  morningBuffaloMl: 0,
  eveningBuffaloMl: 0,
  routeMorning: 1,
  routeEvening: 1
};

const token = user => jwt.sign({}, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'gauamrut', expiresIn: '1h' });
const get = (path, t = tokenA) => request(app).get('/api' + path).set('Authorization', `Bearer ${t}`);
const post = (path, body, key = 'fin-key-' + Math.floor(Math.random() * 10000000000), t = tokenA) =>
  request(app).post('/api' + path).set('Authorization', `Bearer ${t}`).set('Idempotency-Key', key).send(body);
const patch = (path, body, t = tokenA) => request(app).patch('/api' + path).set('Authorization', `Bearer ${t}`).send(body);

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-financial-secret-at-least-32-chars-long';
  process.env.NODE_ENV = 'development';
  let systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
  if (!systemBinary) {
    try {
      systemBinary = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['mongod'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    } catch {
      /* CI binary fallback */
    }
  }
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, version: process.env.MONGOMS_VERSION || '8.0.28' } : { version: '8.0.28' },
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  await mongoose.connect(replica.getUri('gauamrut_fin_test'));
  await Promise.all(Object.values(models).map(m => m.init()));
  app = createApp();
});

beforeEach(async () => {
  app = createApp();
  await Promise.all(Object.values(models).map(m => m.deleteMany({})));

  const dairyId = new mongoose.Types.ObjectId();
  ownerA = await models.User.create({
    email: 'dairy-owner@example.com',
    name: 'Aarav Dairy Owner',
    password: 'password-hash',
    role: 'milkman',
    milkman_id: dairyId
  });

  await models.Milkman.create({
    _id: dairyId,
    user_id: ownerA._id,
    businessName: 'Aarav Organic Milk',
    name: 'Aarav Patel',
    phone: '9825012345',
    upiId: 'aarav@okaxis',
    code: 'AARAV123'
  });

  customerDocA = await models.Customer.create({
    ...customerFields,
    milkman_id: dairyId,
    openingBalancePaise: 5000 // ₹50.00 initial legacy ledger balance
  });

  customerUserA = await models.User.create({
    email: 'kavita@example.com',
    name: 'Kavita Patel',
    password: 'password-hash',
    role: 'customer',
    milkman_id: dairyId,
    customer_id: customerDocA._id
  });

  await models.Customer.updateOne({ _id: customerDocA._id }, { user_id: customerUserA._id });

  tokenA = token(ownerA);
  customerTokenA = token(customerUserA);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

describe('Milestone 3 - Financial Workflow & Commerce', () => {
  test('opening balance accounting and multi-month carry-forward rollover', async () => {
    // 1. Deliveries in month 2025-01: 1500ml cow @ 60/L = 9000 paise each, 2 days = 18000 paise
    await post('/records/batch', {
      items: [
        { customer_id: String(customerDocA._id), date: '2025-01-10', shift: 'morning', type: 'cow', quantityMl: 1500 },
        { customer_id: String(customerDocA._id), date: '2025-01-11', shift: 'morning', type: 'cow', quantityMl: 1500 }
      ]
    });

    // 2. Generate bill for 2025-01
    const bill1Res = await post('/bills', { customer_id: String(customerDocA._id), month: '2025-01' });
    expect(bill1Res.status).toBe(201);
    const bill1 = bill1Res.body.data;
    expect(bill1.openingPaise).toBe(5000); // from customer.openingBalancePaise
    expect(bill1.chargesPaise).toBe(18000);
    expect(bill1.closingPaise).toBe(23000); // 5000 + 18000

    // 3. Deliveries in month 2025-02: 1 day = 9000 paise
    await post('/records/batch', {
      items: [
        { customer_id: String(customerDocA._id), date: '2025-02-05', shift: 'morning', type: 'cow', quantityMl: 1500 }
      ]
    });

    // 4. Generate bill for 2025-02 without settling previous bill:
    // Should NOT fail with UNSETTLED_PREVIOUS_BILL, but roll 23000 forward into openingPaise!
    const bill2Res = await post('/bills', { customer_id: String(customerDocA._id), month: '2025-02' });
    expect(bill2Res.status).toBe(201);
    const bill2 = bill2Res.body.data;
    expect(bill2.openingPaise).toBe(23000); // rolled over from bill1 closing
    expect(bill2.chargesPaise).toBe(9000);
    expect(bill2.closingPaise).toBe(32000); // 23000 + 9000
  });

  test('payment allocation, balance reduction, and structured digital receipt generation', async () => {
    // Create bill with closing balance
    await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1000 }]
    });
    const billRes = await post('/bills', { customer_id: String(customerDocA._id), month: '2025-01' });
    const bill = billRes.body.data; // opening 5000 + charge 6000 = closing 11000

    // Record partial payment of ₹60.00 (6000 paise) via UPI
    const payRes = await post('/payments', {
      bill_id: bill._id,
      amountPaise: 6000,
      method: 'upi',
      reference: 'UPI-TXN-998877'
    });
    expect(payRes.status).toBe(201);
    const payment = payRes.body.data;
    expect(payment.receipt).toMatch(/^GA-/);
    expect(payment.balanceBeforePaise).toBe(11000);
    expect(payment.balanceAfterPaise).toBe(5000);

    // Fetch full digital receipt
    const receiptRes = await get(`/payments/${payment._id}/receipt`, customerTokenA);
    expect(receiptRes.status).toBe(200);
    const receipt = receiptRes.body.data;
    expect(receipt.receipt).toBe(payment.receipt);
    expect(receipt.amountPaise).toBe(6000);
    expect(receipt.reference).toBe('UPI-TXN-998877');
    expect(receipt.billMonth).toBe('2025-01');
    expect(receipt.dairy.businessName).toBe('Aarav Organic Milk');
    expect(receipt.dairy.upiId).toBe('aarav@okaxis');
    expect(receipt.customer.name).toBe('Kavita Patel');
    expect(receipt.balanceAfterPaise).toBe(5000);
    expect(receipt.verified).toBe(true);
  });

  test('distributed lock concurrency and automated monthly billing scheduler', async () => {
    // Test lock acquisition and mutual exclusion
    const lock1 = await acquireLock('test_lock_key', 5000, 'worker-1');
    expect(lock1.acquired).toBe(true);

    const lock2 = await acquireLock('test_lock_key', 5000, 'worker-2');
    expect(lock2.acquired).toBe(false);

    // Release and reacquire
    await releaseLock('test_lock_key', 'worker-1');
    const lock3 = await acquireLock('test_lock_key', 5000, 'worker-2');
    expect(lock3.acquired).toBe(true);
    await releaseLock('test_lock_key', 'worker-2');

    // Setup deliveries for completed month
    await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date: '2025-01-20', shift: 'morning', type: 'cow', quantityMl: 2000 }]
    });

    // Run scheduler batch generation
    const batchRes = await post('/bills/batch-generate', { month: '2025-01' }, 'batch-run-1');
    expect(batchRes.status).toBe(200);
    expect(batchRes.body.data.generated).toBe(1);
    expect(batchRes.body.data.targetMonth).toBe('2025-01');

    // Second execution should skip already generated bill
    const batchRepeat = await post('/bills/batch-generate', { month: '2025-01' }, 'batch-run-2');
    expect(batchRepeat.body.data.generated).toBe(0);
    expect(batchRepeat.body.data.skipped).toBeGreaterThanOrEqual(1);

    // Verify audit log recorded scheduler execution
    const audit = await models.Audit.findOne({ action: 'billing.scheduler.run', milkman_id: ownerA.milkman_id });
    expect(audit).toBeTruthy();
    expect(audit.target).toBe('2025-01');
  });

  test('customer payment claim lifecycle: submission, duplicate prevention, rejection with reason, and approval with receipt', async () => {
    // 1. Customer has a bill
    await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date: '2025-01-25', shift: 'morning', type: 'cow', quantityMl: 1000 }]
    });
    const billRes = await post('/bills', { customer_id: String(customerDocA._id), month: '2025-01' });
    const bill = billRes.body.data;

    // 2. Customer submits payment claim
    const claimRes = await request(app)
      .post('/api/payment-claims')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .send({
        bill_id: bill._id,
        amountPaise: 5000,
        method: 'upi',
        reference: 'UTR1122334455',
        notes: 'Paid via GPay this morning'
      });
    expect(claimRes.status).toBe(201);
    const claim = claimRes.body.data;
    expect(claim.status).toBe('pending');
    expect(claim.reference).toBe('UTR1122334455');

    // 3. Submitting duplicate reference while pending is rejected
    const dupRes = await request(app)
      .post('/api/payment-claims')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .send({
        bill_id: bill._id,
        amountPaise: 5000,
        method: 'upi',
        reference: 'UTR1122334455'
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE_REFERENCE');

    // 4. Vendor lists payment claims
    const listRes = await get('/payment-claims', tokenA);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].customerName).toBe('Kavita Patel');

    // 5. Vendor rejects claim with reason
    const rejectRes = await patch(`/payment-claims/${claim._id}/review`, {
      action: 'reject',
      reason: 'UTR number did not reflect in dairy bank account. Please check transaction ID.'
    }, tokenA);
    expect(rejectRes.status).toBe(200);
    const rejectedClaim = rejectRes.body.data;
    expect(rejectedClaim.status).toBe('rejected');
    expect(rejectedClaim.rejectionReason).toContain('did not reflect');

    // 6. Customer submits corrected claim with new reference
    const correctedClaimRes = await request(app)
      .post('/api/payment-claims')
      .set('Authorization', `Bearer ${customerTokenA}`)
      .send({
        bill_id: bill._id,
        amountPaise: 5000,
        method: 'upi',
        reference: 'UTR9988776655',
        notes: 'Corrected bank UTR'
      });
    expect(correctedClaimRes.status).toBe(201);
    const newClaim = correctedClaimRes.body.data;

    // 7. Vendor approves claim
    const approveRes = await patch(`/payment-claims/${newClaim._id}/review`, {
      action: 'approve'
    }, tokenA);
    expect(approveRes.status).toBe(200);
    const approval = approveRes.body.data;
    expect(approval.claim.status).toBe('approved');
    expect(approval.payment.receipt).toMatch(/^GA-/);

    // Verify bill was atomically updated
    const updatedBill = await models.Bill.findById(bill._id);
    expect(updatedBill.paidPaise).toBe(5000);
    expect(updatedBill.closingPaise).toBe(bill.closingPaise - 5000);
  });

  test('payment reversal restores bill balance, requires permission and reason, and creates audit log', async () => {
    // 1. Finalize bill and record payment
    const billRes = await post('/bills', { customer_id: customerDocA._id, month: '2025-01' });
    const bill = billRes.body.data;
    const initialClosing = bill.closingPaise;

    const payRes = await post('/payments', {
      bill_id: bill._id,
      amountPaise: 4000,
      method: 'cash'
    });
    expect(payRes.status).toBe(201);
    const payment = payRes.body.data;

    // Check bill was reduced
    let currentBill = await models.Bill.findById(bill._id);
    expect(currentBill.paidPaise).toBe(4000);
    expect(currentBill.closingPaise).toBe(initialClosing - 4000);

    // 2. Customer cannot reverse payment
    const custReverse = await request(app)
      .post(`/api/payments/${payment._id}/reverse`)
      .set('Authorization', `Bearer ${customerTokenA}`)
      .send({ reason: 'Accidental payment' });
    expect(custReverse.status).toBe(403);

    // 3. Reversal requires valid reason (at least 3 characters)
    const invalidReasonRes = await request(app)
      .post(`/api/payments/${payment._id}/reverse`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'no' });
    expect(invalidReasonRes.status).toBe(400);

    // 4. Vendor successfully reverses payment with reason
    const reverseRes = await request(app)
      .post(`/api/payments/${payment._id}/reverse`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'Cheque bounced due to insufficient funds' });
    expect(reverseRes.status).toBe(200);
    expect(reverseRes.body.data.reversed).toBe(true);
    expect(reverseRes.body.data.reversalReason).toBe('Cheque bounced due to insufficient funds');
    expect(reverseRes.body.data.reversedAt).toBeDefined();

    // 5. Verify bill balance was restored atomically
    currentBill = await models.Bill.findById(bill._id);
    expect(currentBill.paidPaise).toBe(0);
    expect(currentBill.closingPaise).toBe(initialClosing);

    // 6. Cannot reverse already reversed payment
    const duplicateReverse = await request(app)
      .post(`/api/payments/${payment._id}/reverse`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'Duplicate try' });
    expect(duplicateReverse.status).toBe(409);
    expect(duplicateReverse.body.error.code).toBe('ALREADY_REVERSED');

    // 7. Audit log was recorded
    const auditEntry = await models.Audit.findOne({ action: 'payment.reversed', target: String(payment._id) });
    expect(auditEntry).toBeDefined();
    expect(auditEntry.before.reversed).toBe(false);
    expect(auditEntry.after.reversed).toBe(true);
    expect(auditEntry.after.reversalReason).toBe('Cheque bounced due to insufficient funds');

    // 8. Receipt reflects reversed state
    const receiptRes = await get(`/payments/${payment._id}/receipt`, tokenA);
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.data.reversed).toBe(true);
    expect(receiptRes.body.data.reversalReason).toBe('Cheque bounced due to insufficient funds');
  });

  test('adjustments (credit, debit, waiver, refund) with bounds and reversal workflow', async () => {
    // 1. Finalize bill
    const billRes = await post('/bills', { customer_id: customerDocA._id, month: '2025-01' });
    const bill = billRes.body.data;
    const initialClosing = bill.closingPaise;

    // 2. Apply waiver/credit
    const waiverRes = await request(app)
      .post('/api/adjustments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        customer_id: customerDocA._id,
        bill_id: bill._id,
        type: 'waiver',
        amountPaise: 2000,
        reason: 'Courtesy discount for delayed morning delivery'
      });
    expect(waiverRes.status).toBe(201);
    const waiver = waiverRes.body.data.adjustment;
    expect(waiver.type).toBe('waiver');
    expect(waiver.amountPaise).toBe(2000);
    expect(waiver.status).toBe('applied');

    // Bill closingPaise decreased by 2000
    let billCheck = await models.Bill.findById(bill._id);
    expect(billCheck.closingPaise).toBe(initialClosing - 2000);

    // 3. Excess credit is rejected (cannot exceed bill balance)
    const excessCredit = await request(app)
      .post('/api/adjustments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        customer_id: customerDocA._id,
        bill_id: bill._id,
        type: 'credit',
        amountPaise: 999999,
        reason: 'Excess credit attempt'
      });
    expect(excessCredit.status).toBe(409);
    expect(excessCredit.body.error.code).toBe('INVALID_ADJUSTMENT');

    // 4. Apply debit (e.g. extra milk from closed period)
    const debitRes = await request(app)
      .post('/api/adjustments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        customer_id: customerDocA._id,
        bill_id: bill._id,
        type: 'debit',
        amountPaise: 3000,
        reason: 'Unrecorded ghee order from festival week'
      });
    expect(debitRes.status).toBe(201);
    billCheck = await models.Bill.findById(bill._id);
    expect(billCheck.closingPaise).toBe(initialClosing - 2000 + 3000);

    // 5. Query adjustments endpoint (both vendor and customer)
    const vendorList = await get('/adjustments', tokenA);
    expect(vendorList.status).toBe(200);
    expect(vendorList.body.data.length).toBe(2);
    expect(vendorList.body.data[0].customerName).toBe('Kavita Patel');
    expect(vendorList.body.data[0].billMonth).toBe('2025-01');

    const custList = await request(app)
      .get('/api/adjustments')
      .set('Authorization', `Bearer ${customerTokenA}`);
    expect(custList.status).toBe(200);
    expect(custList.body.data.length).toBe(2);

    // 6. Reverse the waiver adjustment
    const revWaiver = await request(app)
      .post(`/api/adjustments/${waiver._id}/reverse`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'Applied to wrong customer account' });
    expect(revWaiver.status).toBe(200);
    expect(revWaiver.body.data.status).toBe('reversed');
    expect(revWaiver.body.data.reversalReason).toBe('Applied to wrong customer account');

    // Bill closingPaise restored (waiver reversed adds back 2000)
    billCheck = await models.Bill.findById(bill._id);
    expect(billCheck.closingPaise).toBe(initialClosing + 3000);

    // 7. Cannot double reverse
    const doubleRev = await request(app)
      .post(`/api/adjustments/${waiver._id}/reverse`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'Again' });
    expect(doubleRev.status).toBe(409);
    expect(doubleRev.body.error.code).toBe('ALREADY_REVERSED');
  });
});

describe('Mid-month billing, live bill refresh, and till-date dashboard stats', () => {
  test('bills can be generated for the current month, refresh after new entries, and drive till-date dashboard numbers', async () => {
    const month = today().slice(0, 7);
    const date = today();

    // 1. Milk delivered today (1000 ml cow @ ₹60/L = 6000 paise).
    const firstEntry = await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date, shift: 'morning', type: 'cow', quantityMl: 1000 }]
    });
    expect(firstEntry.status).toBe(201);

    // 2. Generate the bill mid-month — previously rejected with MONTH_OPEN.
    const billRes = await post('/bills', { customer_id: String(customerDocA._id), month });
    expect(billRes.status).toBe(201);
    const bill = billRes.body.data;
    expect(bill.openingPaise).toBe(5000); // legacy opening balance
    expect(bill.chargesPaise).toBe(6000);
    expect(bill.closingPaise).toBe(11000);

    // 3. Partial payment against the open bill.
    const payment = await post('/payments', { bill_id: bill._id, amountPaise: 3000, method: 'upi', reference: `MIDMONTH-UTR-${Date.now()}` });
    expect(payment.status).toBe(201);

    // 4. Another delivery for the same month while the bill exists — previously PERIOD_CLOSED.
    const secondEntry = await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date, shift: 'evening', type: 'cow', quantityMl: 500 }]
    });
    expect(secondEntry.status).toBe(201);

    // 5. Regenerating refreshes the same bill instead of returning a stale copy.
    const refreshedRes = await post('/bills', { customer_id: String(customerDocA._id), month });
    expect(refreshedRes.status).toBe(201);
    const refreshed = refreshedRes.body.data;
    expect(String(refreshed._id)).toBe(String(bill._id));
    expect(refreshed.chargesPaise).toBe(9000); // 6000 + 3000
    expect(refreshed.paidPaise).toBe(3000);
    expect(refreshed.closingPaise).toBe(11000); // 5000 + 9000 - 3000

    // 6. Dashboard: till-date outstanding and month-to-date collections.
    const dash = await get('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.data.outstandingPaise).toBe(11000);
    expect(dash.body.data.collectedPaise).toBe(3000);

    // 7. Batch billing for the current month runs without errors.
    const batch = await post('/bills/batch-generate', { month });
    expect(batch.status).toBe(200);
    expect(batch.body.data.errors).toEqual([]);
    expect(batch.body.data.generated + batch.body.data.updated + batch.body.data.skipped).toBeGreaterThanOrEqual(1);
  });

  test('bill refresh preserves payments, waivers and debits already applied', async () => {
    const month = today().slice(0, 7);
    const date = today();
    await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date, shift: 'morning', type: 'cow', quantityMl: 1000 }]
    });
    const bill = (await post('/bills', { customer_id: String(customerDocA._id), month })).body.data; // 5000 + 6000 = 11000

    // Ledger adjustments mutate closingPaise directly: waiver −2000, debit +1000.
    const waiver = await request(app).post('/api/adjustments').set('Authorization', `Bearer ${tokenA}`)
      .send({ customer_id: customerDocA._id, bill_id: bill._id, type: 'waiver', amountPaise: 2000, reason: 'Goodwill waiver for slow delivery week' });
    expect(waiver.status).toBe(201);
    const debit = await request(app).post('/api/adjustments').set('Authorization', `Bearer ${tokenA}`)
      .send({ customer_id: customerDocA._id, bill_id: bill._id, type: 'debit', amountPaise: 1000, reason: 'Extra paneer order billed late' });
    expect(debit.status).toBe(201);

    // One more delivery, then refresh the bill.
    await post('/records/batch', {
      items: [{ customer_id: String(customerDocA._id), date, shift: 'evening', type: 'cow', quantityMl: 1000 }]
    });
    const refreshed = (await post('/bills', { customer_id: String(customerDocA._id), month })).body.data;
    expect(refreshed.chargesPaise).toBe(12000);
    // 5000 opening + 12000 charges − 0 paid − 2000 waiver + 1000 debit = 16000.
    expect(refreshed.closingPaise).toBe(16000);
  });

  test('future months cannot be billed', async () => {
    const single = await post('/bills', { customer_id: String(customerDocA._id), month: '2099-12' });
    expect(single.status).toBe(409);
    expect(single.body.error.code).toBe('FUTURE_MONTH');

    const batch = await post('/bills/batch-generate', { month: '2099-12' });
    expect(batch.status).toBe(409);
    expect(batch.body.error.code).toBe('FUTURE_MONTH');
  });
});

