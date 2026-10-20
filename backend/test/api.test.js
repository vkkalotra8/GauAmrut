const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const models = require('../src/models');
const { createApp } = require('../src/app');
let replica, app, ownerA, ownerB, tokenA, tokenB, customerA, customerB;
const customerFields = { name: 'Meera Shah', phone: '9876543210', address: 'Green Park', startDate: '2025-01-01', cowRatePaise: 6000, buffaloRatePaise: 8000, morningCowMl: 1000, eveningCowMl: 0, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: 0, routeEvening: 0 };
const token = user => jwt.sign({}, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'gauamrut', expiresIn: '1h' });
const get = (path, t = tokenA) => request(app).get('/api' + path).set('Authorization', `Bearer ${t}`);
const post = (path, body, key = 'test-key-12345', t = tokenA) => request(app).post('/api' + path).set('Authorization', `Bearer ${t}`).set('Idempotency-Key', key).send(body);
const delivery = (customer = customerA, extra = {}) => ({ items: [{ customer_id: String(customer._id), date: '2025-01-15', shift: 'morning', type: 'cow', quantityMl: 1500, ...extra }] });
beforeAll(async () => {
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters-long';
  process.env.NODE_ENV = 'development'; process.env.DEV_SHOW_OTP = 'true';
  let systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
  if (!systemBinary) { try { systemBinary = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['mongod'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]; } catch { /* CI downloads a test-only binary if mongod is unavailable. */ } }
  replica = await MongoMemoryReplSet.create({ binary: systemBinary ? { systemBinary, version: process.env.MONGOMS_VERSION || '8.0.28' } : { version: '8.0.28' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri('gauamrut_test'));
  await Promise.all(Object.values(models).map(m => m.init())); app = createApp();
});
beforeEach(async () => {
  app = createApp();
  await Promise.all(Object.values(models).map(m => m.deleteMany({})));
  const a = new mongoose.Types.ObjectId(), b = new mongoose.Types.ObjectId();
  [ownerA, ownerB] = await models.User.create([{ email: 'a@test.example', name: 'A', password: 'not-a-real-hash', role: 'milkman', milkman_id: a }, { email: 'b@test.example', name: 'B', password: 'not-a-real-hash', role: 'milkman', milkman_id: b }]);
  await models.Milkman.create([{ _id: a, user_id: ownerA._id, businessName: 'Dairy A', code: 'AAAAAAAA' }, { _id: b, user_id: ownerB._id, businessName: 'Dairy B', code: 'BBBBBBBB' }]);
  [customerA, customerB] = await models.Customer.create([{ ...customerFields, milkman_id: a }, { ...customerFields, name: 'Private Customer B', milkman_id: b }]);
  tokenA = token(ownerA); tokenB = token(ownerB);
});
afterAll(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });

describe('Authentication and authorization', () => {
  test('registration uses one-time OTP and creates the user/profile together', async () => {
    const body = { name: 'New Owner', businessName: 'New Dairy', phone: '9876543210', email: 'NEW@example.com', password: 'a-strong-password' };
    const issued = await request(app).post('/api/auth/register').send(body);
    expect(issued.status).toBe(202); expect(issued.body.data.developmentOtp).toMatch(/^\d{6}$/);
    expect(await models.User.countDocuments({ email: 'new@example.com' })).toBe(0);
    const verified = await request(app).post('/api/auth/verify').send({ email: body.email, otp: issued.body.data.developmentOtp });
    expect(verified.status).toBe(201); expect(verified.body.data.user.businessName).toBe('New Dairy');
    expect(JSON.stringify(verified.body)).not.toContain('password');
    const user = await models.User.findOne({ email: 'new@example.com' });
    expect(await models.Milkman.countDocuments({ user_id: user._id })).toBe(1);
    expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: issued.body.data.developmentOtp })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: body.email, password: body.password })).status).toBe(200);
  });
  test('rejects unauthenticated and disabled-user access', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
    await models.User.updateOne({ _id: ownerA._id }, { active: false });
    expect((await get('/customers')).status).toBe(401);
  });
  test('tenant IDs and MongoDB operators cannot be injected into payloads', async () => {
    expect((await post('/customers', { ...customerFields, milkman_id: String(ownerB.milkman_id) })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 'anything' })).status).toBe(400);
    expect((await get('/customers?q=%5B')).status).toBe(200);
    expect((await get('/customers?page=-1')).status).toBe(400);
  });
  test('customer directory, lifecycle and deliveries are tenant isolated', async () => {
    const list = await get('/customers'); expect(list.body.data).toHaveLength(1); expect(list.body.data[0]._id).toBe(String(customerA._id));
    expect((await request(app).patch(`/api/customers/${customerB._id}/status`).set('Authorization', `Bearer ${tokenA}`).send({ status: 'inactive' })).status).toBe(404);
    expect((await post('/records/batch', delivery(customerB))).status).toBe(404);
    expect((await post('/bills', { customer_id: String(customerB._id), month: '2025-01' })).status).toBe(404);
  });
  test('customer role can only read its own records and cannot use vendor writes', async () => {
    await post('/records/batch', delivery());
    const other = await models.Customer.create({ ...customerFields, milkman_id: ownerA.milkman_id });
    const customerUser = await models.User.create({ name: 'Customer', email: 'customer@test.example', password: 'hash', role: 'customer', milkman_id: ownerA.milkman_id, customer_id: other._id });
    await models.Customer.updateOne({ _id: other._id }, { user_id: customerUser._id });
    const t = token(customerUser);
    expect((await get('/records', t)).body.data).toHaveLength(0);
    expect((await get('/customers', t)).status).toBe(403);
    expect((await post('/records/batch', delivery(), 'customer-write-1', t)).status).toBe(403);
    expect((await get('/reports/deliveries.csv?month=2025-01', t)).text).not.toContain(String(customerA._id));
  });
});
describe('Transactional delivery ledger', () => {
  test('server snapshots rates and exact totals; retries create one record', async () => {
    const first = await post('/records/batch', delivery());
    expect(first.status).toBe(201); expect(first.body.data[0].totalPaise).toBe(9000);
    await models.Customer.updateOne({ _id: customerA._id }, { cowRatePaise: 7000 });
    const replay = await post('/records/batch', delivery());
    expect(replay.body.data[0]._id).toBe(first.body.data[0]._id);
    expect(replay.body.data[0].ratePaise).toBe(6000);
    expect(await models.Record.countDocuments()).toBe(1);
    expect((await post('/records/batch', delivery(customerA, { quantityMl: 2000 }))).status).toBe(409);
  });
  test('concurrent duplicate requests write exactly once', async () => {
    const results = await Promise.all([post('/records/batch', delivery()), post('/records/batch', delivery())]);
    expect(results.map(r => r.status)).toEqual([201, 201]); expect(await models.Record.countDocuments()).toBe(1);
    expect(results[0].body.data[0]._id).toBe(results[1].body.data[0]._id);
  });
  test('logical delivery uniqueness survives a different retry key', async () => {
    await post('/records/batch', delivery());
    expect((await post('/records/batch', delivery(), 'another-key-123')).status).toBe(409);
    expect(await models.Record.countDocuments()).toBe(1);
  });
  test('a failed batch is rolled back in its entirety', async () => {
    const body = { items: [...delivery().items, ...delivery(customerB).items] };
    expect((await post('/records/batch', body)).status).toBe(404);
    expect(await models.Record.countDocuments()).toBe(0); expect(await models.Idempotency.countDocuments()).toBe(0);
  });
  test('rejects impossible dates and missing idempotency keys', async () => {
    expect((await post('/records/batch', delivery(customerA, { date: '2025-02-30' }))).status).toBe(400);
    expect((await request(app).post('/api/records/batch').set('Authorization', `Bearer ${tokenA}`).send(delivery())).status).toBe(400);
  });
  test('vendor may correct and soft-delete open delivery records with audit diff', async () => {
    const batch = await post('/records/batch', delivery());
    const recId = batch.body.data[0]._id;

    const corrected = await request(app)
      .patch(`/api/records/${recId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ quantityMl: 2000 });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.quantityMl).toBe(2000);
    expect(corrected.body.data.totalPaise).toBe(12000);
    expect(await models.Audit.countDocuments({ action: 'delivery.corrected', target: recId })).toBe(1);

    const deleted = await request(app)
      .delete(`/api/records/${recId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect(await models.Audit.countDocuments({ action: 'delivery.deleted', target: recId })).toBe(1);

    const list = await get('/records');
    expect(list.body.data).toHaveLength(0);

    const reentered = await post('/records/batch', delivery(), 're-enter-key');
    expect(reentered.status).toBe(201);
    expect(reentered.body.data[0]._id).toBe(recId);
    expect(await models.Record.countDocuments({ deleted: false })).toBe(1);
  });
  test('billed deliveries cannot be corrected or deleted', async () => {
    await post('/records/batch', delivery(), 'del-to-bill');
    const rec = (await models.Record.findOne()).toObject();
    await post('/bills', { customer_id: String(customerA._id), month: '2025-01' }, 'bill-lock-key');

    expect((await request(app).patch(`/api/records/${rec._id}`).set('Authorization', `Bearer ${tokenA}`).send({ quantityMl: 2500 })).status).toBe(409);
    expect((await request(app).delete(`/api/records/${rec._id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(409);
  });
});
describe('Bills, collections and exports', () => {
  async function makeBill() {
    await post('/records/batch', delivery(), 'delivery-for-bill');
    const response = await post('/bills', { customer_id: String(customerA._id), month: '2025-01' }, 'generate-bill-key');
    expect(response.status).toBe(201); return response.body.data;
  }
  test('bill and export totals agree, and other tenants cannot read the ledger', async () => {
    const bill = await makeBill(); expect(bill.chargesPaise).toBe(9000);
    const report = await get('/reports/deliveries.csv?month=2025-01');
    expect(report.status).toBe(200); expect(report.text).toContain('"Total paise","9000"'); expect(report.text).toContain('Dairy A');
    expect((await get('/reports/deliveries.csv?month=2025-01', tokenB)).text).not.toContain(String(customerA._id));
    expect((await get('/bills', tokenB)).body.data).toHaveLength(0);
    expect((await get('/records', tokenB)).body.data).toHaveLength(0);
    expect((await get('/dashboard', tokenB)).body.data.today.entries).toBe(0);
    expect((await post('/records/batch', delivery(customerA, { shift: 'evening' }), 'late-delivery-key')).status).toBe(409);
  });
  test('concurrent payment retries allocate once and produce a single receipt', async () => {
    const bill = await makeBill(), body = { bill_id: bill._id, amountPaise: 4000, method: 'cash' };
    const responses = await Promise.all([post('/payments', body, 'payment-retry-key'), post('/payments', body, 'payment-retry-key')]);
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    expect(responses[0].body.data.receipt).toBe(responses[1].body.data.receipt);
    expect(await models.Payment.countDocuments()).toBe(1);
    expect((await models.Bill.findById(bill._id)).closingPaise).toBe(5000);
    expect((await get('/payments', tokenB)).body.data).toHaveLength(0);
    expect((await post('/payments', { ...body, amountPaise: 6000 }, 'too-large-payment')).status).toBe(409);
    expect((await post('/payments', body, 'foreign-payment-key', tokenB)).status).toBe(409);
  });
  test('different concurrent payments cannot over-allocate the debt', async () => {
    const bill = await makeBill(), body = { bill_id: bill._id, amountPaise: 6000, method: 'cash' };
    const responses = await Promise.all([post('/payments', body, 'payment-one-key'), post('/payments', body, 'payment-two-key')]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await models.Bill.findById(bill._id)).closingPaise).toBe(3000);
  });
  test('reused provider reference rolls back bill allocation', async () => {
    const bill = await makeBill(), body = { bill_id: bill._id, amountPaise: 1000, method: 'upi', reference: 'provider-ref-123' };
    expect((await post('/payments', body, 'provider-payment-one')).status).toBe(201);
    expect((await post('/payments', body, 'provider-payment-two')).status).toBe(409);
    expect((await models.Bill.findById(bill._id)).paidPaise).toBe(1000);
  });
});

describe('Customer onboarding and account controls', () => {
  const registration = (extra = {}) => ({ name: 'Customer One', email: 'customer@example.com', password: 'customer-password-123', phone: '9876543210', code: 'AAAAAAAA', ...extra });
  async function verifyCustomer(body = registration()) {
    const issued = await request(app).post('/api/auth/customer/register').send(body);
    expect(issued.status).toBe(202);
    const verified = await request(app).post('/api/auth/verify').send({ email: body.email, otp: issued.body.data.developmentOtp });
    expect(verified.status).toBe(201);
    return verified.body.data;
  }
  async function connect(body) { return request(app).post('/api/auth/customer/complete').send(body); }
  test('code lookup exposes only the dairy identity, with no customer data', async () => {
    const response = await request(app).post('/api/auth/dairy/resolve').send({ code: 'aaaaaaaa' });
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ businessName: 'Dairy A', code: 'AAAAAAAA' });
    expect((await request(app).post('/api/auth/dairy/resolve').send({ code: 'UNKNOWN1' })).status).toBe(404);
  });
  test('verified new customer connects atomically as inactive without trusting client rates or tenant IDs', async () => {
    expect((await request(app).post('/api/auth/customer/register').send(registration({ cowRatePaise: 1 }))).status).toBe(400);
    const pending = await verifyCustomer();
    expect(pending.onboardingRequired).toBe(true); expect(pending.historyCandidates).toEqual([]);
    expect(await models.User.exists({ email: 'customer@example.com' })).toBeNull();
    const response = await connect({ onboardingToken: pending.onboardingToken, createNew: true });
    expect(response.status).toBe(201); expect(response.body.data.user.role).toBe('customer');
    const profile = await models.Customer.findById(response.body.data.user.customer_id);
    expect(profile.status).toBe('inactive'); expect(profile.cowRatePaise).toBe(0);
    expect(String(profile.milkman_id)).toBe(String(ownerA.milkman_id));
    expect(String(profile.user_id)).toBe(response.body.data.user.id);
    expect((await connect({ onboardingToken: pending.onboardingToken, createNew: true })).status).toBe(400);
  });
  test('history claim preserves ledger, billing, rates and ownership after exact email verification', async () => {
    await models.Customer.updateOne({ _id: customerA._id }, { email: 'customer@example.com' });
    await post('/records/batch', delivery(), 'history-delivery-key');
    const bill = await post('/bills', { customer_id: String(customerA._id), month: '2025-01' }, 'history-bill-key');
    const pending = await verifyCustomer();
    expect(pending.historyCandidates.map(c => c._id)).toEqual([String(customerA._id)]);
    const response = await connect({ onboardingToken: pending.onboardingToken, claimCustomerId: String(customerA._id) });
    expect(response.status).toBe(201);
    const session = response.body.data;
    expect(session.user.customer_id).toBe(String(customerA._id));
    expect((await get('/records', session.token)).body.data[0].totalPaise).toBe(9000);
    expect((await get('/bills', session.token)).body.data[0]._id).toBe(bill.body.data._id);
    expect((await models.Customer.findById(customerA._id)).cowRatePaise).toBe(6000);
    expect(await models.Customer.countDocuments({ milkman_id: ownerA.milkman_id })).toBe(1);
  });
  test('wrong-email and foreign-tenant history claims fail without consuming the onboarding session', async () => {
    await models.Customer.updateOne({ _id: customerB._id }, { email: 'customer@example.com' });
    const pending = await verifyCustomer();
    expect(pending.historyCandidates).toEqual([]);
    for (const customer of [customerA, customerB]) expect((await connect({ onboardingToken: pending.onboardingToken, claimCustomerId: String(customer._id) })).status).toBe(409);
    expect(await models.User.countDocuments({ role: 'customer' })).toBe(0);
    expect((await connect({ onboardingToken: pending.onboardingToken, createNew: true })).status).toBe(201);
  });
  test('concurrent completion of one verified ticket creates one user and one profile', async () => {
    const pending = await verifyCustomer();
    const body = { onboardingToken: pending.onboardingToken, createNew: true };
    const responses = await Promise.all([connect(body), connect(body)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    expect(await models.User.countDocuments({ role: 'customer' })).toBe(1);
    expect(await models.Customer.countDocuments({ email: 'customer@example.com' })).toBe(1);
  });
  test('expired onboarding cannot create a profile or account', async () => {
    const pending = await verifyCustomer();
    await models.Onboarding.updateMany({}, { expiry: new Date(Date.now() - 1000) });
    expect((await connect({ onboardingToken: pending.onboardingToken, createNew: true })).status).toBe(400);
    expect(await models.User.countDocuments({ role: 'customer' })).toBe(0);
  });
  test('new dairy code invalidates pending onboarding without breaking an already linked customer', async () => {
    const pending = await verifyCustomer();
    const data = (await connect({ onboardingToken: pending.onboardingToken, createNew: true })).body.data;
    const another = await verifyCustomer(registration({ email: 'second@example.com' }));
    const rotated = await post('/profile/code', {});
    expect(rotated.status).toBe(200); expect(rotated.body.data.code).not.toBe('AAAAAAAA');
    expect((await request(app).post('/api/auth/dairy/resolve').send({ code: 'AAAAAAAA' })).status).toBe(404);
    expect((await connect({ onboardingToken: another.onboardingToken, createNew: true })).status).toBe(404);
    expect((await get('/profile', data.token)).status).toBe(200);
    expect(await models.Audit.countDocuments({ action: 'milkman.code.regenerated', milkman_id: ownerA.milkman_id })).toBe(1);
  });
  test('customer may edit name/address/language but cannot change rates, tenant, role or email', async () => {
    const pending = await verifyCustomer(), connected = await connect({ onboardingToken: pending.onboardingToken, createNew: true }), t = connected.body.data.token;
    const body = { name: 'Updated Customer', address: 'New address', language: 'gu' };
    const patch = b => request(app).patch('/api/profile').set('Authorization', `Bearer ${t}`).send(b);
    expect((await patch(body)).status).toBe(200);
    expect((await get('/auth/me', t)).body.data.name).toBe('Updated Customer');
    for (const field of ['cowRatePaise', 'milkman_id', 'role', 'email']) expect((await patch({ ...body, [field]: 'forbidden' })).status).toBe(400);
    expect((await post('/profile/code', {}, 'customer-code-key', t)).status).toBe(403);
    expect((await get('/customers', t)).status).toBe(403);
  });
  test('vendor may edit business profile and upiId with audit logging and user name synchronization', async () => {
    const patch = b => request(app).patch('/api/profile').set('Authorization', `Bearer ${tokenA}`).send(b);
    const updated = await patch({ businessName: 'Aarav Organic Dairy', name: 'Aarav K. Patel', phone: '9876543299', upiId: 'aarav@okhdfcbank' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.businessName).toBe('Aarav Organic Dairy');
    expect(updated.body.data.upiId).toBe('aarav@okhdfcbank');
    expect((await get('/auth/me')).body.data.name).toBe('Aarav K. Patel');
    expect((await get('/auth/me')).body.data.businessName).toBe('Aarav Organic Dairy');
    expect(await models.Audit.countDocuments({ action: 'milkman.profile.updated', milkman_id: ownerA.milkman_id })).toBe(1);

    expect((await patch({ businessName: 'Bad', name: 'Bad', phone: '123', upiId: 'invalid-upi' })).status).toBe(400);
    expect((await patch({ businessName: 'Bad', name: 'Bad', upiId: 'ok@bank' })).status).toBe(400);
  });
  test('vendor may reorder customer routes for morning and evening shifts with audit logs', async () => {
    const cust2 = await models.Customer.create({ ...customerFields, name: 'Zoe Patel', milkman_id: ownerA.milkman_id, routeMorning: 1, routeEvening: 10 });
    await models.Customer.updateOne({ _id: customerA._id }, { routeMorning: 2, routeEvening: 5 });

    let morningList = await get('/customers?shift=morning');
    expect(morningList.body.data[0]._id).toBe(String(cust2._id));

    const reorderMorning = await request(app)
      .patch('/api/customers/route-order')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        shift: 'morning',
        orders: [
          { customer_id: String(customerA._id), order: 0 },
          { customer_id: String(cust2._id), order: 1 }
        ]
      });
    expect(reorderMorning.status).toBe(200);
    expect(reorderMorning.body.data.updated).toBe(true);
    expect(await models.Audit.countDocuments({ action: 'customer.routes.reordered', milkman_id: ownerA.milkman_id })).toBe(1);

    morningList = await get('/customers?shift=morning');
    expect(morningList.body.data[0]._id).toBe(String(customerA._id));

    const reorderEvening = await request(app)
      .patch('/api/customers/route-order')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        shift: 'evening',
        orders: [
          { customer_id: String(cust2._id), order: 0 },
          { customer_id: String(customerA._id), order: 1 }
        ]
      });
    expect(reorderEvening.status).toBe(200);

    const eveningList = await get('/customers?shift=evening');
    expect(eveningList.body.data[0]._id).toBe(String(cust2._id));

    expect((await request(app).patch('/api/customers/route-order').set('Authorization', `Bearer ${tokenA}`).send({
      shift: 'morning',
      orders: [{ customer_id: String(customerB._id), order: 0 }]
    })).status).toBe(404);
  });
  test('vendor customer edits preserve historical rates and audit lifecycle changes', async () => {
    await post('/records/batch', delivery());
    const response = await request(app).put(`/api/customers/${customerA._id}`).set('Authorization', `Bearer ${tokenA}`).send({ ...customerFields, email: 'CONTACT@example.com', cowRatePaise: 7500, status: 'inactive' });
    expect(response.status).toBe(200); expect(response.body.data.email).toBe('contact@example.com');
    expect((await models.Record.findOne()).ratePaise).toBe(6000);
    expect(await models.Audit.countDocuments({ action: 'customer.updated' })).toBe(1);
    expect((await request(app).put(`/api/customers/${customerB._id}`).set('Authorization', `Bearer ${tokenA}`).send({ ...customerFields, status: 'active' })).status).toBe(404);
  });
  test('logout revokes an existing JWT at the backend', async () => {
    expect((await post('/auth/logout', {})).status).toBe(200);
    expect((await get('/dashboard')).status).toBe(401);
    expect((await get('/dashboard', tokenB)).status).toBe(200);
  });
  test('broken customer profile linkage is rejected even with a valid JWT', async () => {
    const pending = await verifyCustomer(), connected = await connect({ onboardingToken: pending.onboardingToken, createNew: true });
    await models.Customer.updateOne({ _id: connected.body.data.user.customer_id }, { $unset: { user_id: 1 } });
    expect((await get('/records', connected.body.data.token)).status).toBe(403);
  });
});

describe('OTP regression checks', () => {
  const body = { name: 'OTP Owner', businessName: 'OTP Dairy', phone: '9876543210', email: 'otp@example.com', password: 'password-for-otp' };
  test('expired OTP is rejected without creating an account', async () => {
    const issued = await request(app).post('/api/auth/register').send(body);
    await models.Otp.updateOne({ email: body.email }, { expiry: new Date(Date.now() - 1000) });
    expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: issued.body.data.developmentOtp })).status).toBe(400);
    expect(await models.User.exists({ email: body.email })).toBeNull();
  });
  test('five failed attempts prevent subsequent use of the correct OTP', async () => {
    const issued = await request(app).post('/api/auth/register').send(body);
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: '000000' })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: issued.body.data.developmentOtp })).status).toBe(400);
    expect(await models.User.exists({ email: body.email })).toBeNull();
  });
  test('replacement invalidates the previous code', async () => {
    const random = jest.spyOn(require('node:crypto'), 'randomInt').mockReturnValueOnce(123456).mockReturnValueOnce(654321);
    try {
      await request(app).post('/api/auth/register').send(body);
      await request(app).post('/api/auth/register').send(body);
      expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: '123456' })).status).toBe(400);
      expect((await request(app).post('/api/auth/verify').send({ email: body.email, otp: '654321' })).status).toBe(201);
    } finally { random.mockRestore(); }
  });
});

describe('Admin access boundaries', () => {
  async function administrator(adminRole = 'super_admin') {
    return models.User.create({ name: 'Test Admin', email: 'admin@example.com', password: await require('bcryptjs').hash('admin-test-password', 4), role: 'admin', adminRole });
  }
  test('admin can sign in and read dashboard and directories without credential leakage', async () => {
    const admin = await administrator();
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'admin-test-password' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.permissions).toContain('audit.read');
    const t = login.body.data.token;
    expect((await get('/admin/dashboard', t)).body.data.dairies).toBe(2);
    for (const path of ['/admin/users', '/admin/dairies', '/admin/activity']) expect((await get(path, t)).status).toBe(200);
    const users = await get('/admin/users', t);
    expect(users.body.data.every(u => !('password' in u) && !('sessionVersion' in u))).toBe(true);
    expect((await get('/admin/users?page=-1', t)).status).toBe(400);
  });
  test('vendors and unauthenticated users cannot read admin data', async () => {
    for (const path of ['/admin/dashboard', '/admin/users', '/admin/dairies', '/admin/activity']) {
      expect((await get(path)).status).toBe(403);
      expect((await request(app).get('/api' + path)).status).toBe(401);
    }
  });
  test('named permissions are enforced even when role is admin', async () => {
    const admin = await administrator('support'), t = token(admin);
    expect((await get('/admin/users', t)).status).toBe(200);
    expect((await get('/admin/activity', t)).status).toBe(403);
    expect((await get('/admin/dashboard', t)).status).toBe(403);
    await models.User.updateOne({ _id: admin._id }, { adminRole: 'finance' });
    expect((await get('/admin/users', t)).status).toBe(403);
  });
  test('admin cannot fall through tenant-scoped endpoints or bypass deactivation', async () => {
    const admin = await administrator(), t = token(admin);
    for (const path of ['/records', '/bills', '/payments', '/profile', '/reports/deliveries.csv']) expect((await get(path, t)).status).toBe(403);
    await models.User.updateOne({ _id: admin._id }, { active: false });
    expect((await get('/admin/users', t)).status).toBe(401);
  });
  test('public registration cannot create or promote an administrator', async () => {
    const response = await request(app).post('/api/auth/register').send({ name: 'Fake Admin', businessName: 'Fake', email: 'fake@example.com', phone: '9876543210', password: 'test-password', role: 'admin', adminRole: 'super_admin' });
    expect(response.status).toBe(400);
    expect(await models.User.countDocuments({ role: 'admin' })).toBe(0);
  });
});
