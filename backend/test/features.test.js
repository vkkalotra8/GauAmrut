const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const { User, Milkman, Customer, Bill, Payment, Record, Dispute, DeliveryAdjustment, Notification, AdminSetting } = require('../src/models');
const { createNotification } = require('../src/notifications');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = '12345678901234567890123456789012';
process.env.CORS_ORIGINS = 'http://127.0.0.1:5173';

let replSet, app;
let vendorToken, customerToken, superAdminToken, operationsToken;
let vendorUser, customerUser, superAdminUser, operationsUser;
let milkmanDoc, customerDoc, testBill;
const makeToken = user => jwt.sign({ sv: 0 }, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'gauamrut', algorithm: 'HS256' });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  app = createApp(null);

  // Create super admin
  superAdminUser = await User.create({
    email: 'superadmin@gauamrut.local',
    password: 'Password123!',
    role: 'admin',
    adminRole: 'super_admin',
    name: 'Super Admin'
  });
  superAdminToken = makeToken(superAdminUser);

  // Create operations admin
  operationsUser = await User.create({
    email: 'ops@gauamrut.local',
    password: 'Password123!',
    role: 'admin',
    adminRole: 'operations',
    name: 'Operations Admin'
  });
  operationsToken = makeToken(operationsUser);

  // Create vendor
  const milkmanId = new mongoose.Types.ObjectId();
  vendorUser = await User.create({
    email: 'vendor@gauamrut.local',
    password: 'Password123!',
    role: 'milkman',
    milkman_id: milkmanId,
    name: 'Dairy Owner'
  });
  milkmanDoc = await Milkman.create({
    _id: milkmanId,
    user_id: vendorUser._id,
    businessName: 'GauAmrut Organic Farm',
    name: 'Dairy Owner',
    phone: '9876543210',
    upiId: 'dairy@upi',
    code: 'DAIRY123',
    verified: true
  });
  vendorToken = makeToken(vendorUser);

  // Create customer
  customerDoc = await Customer.create({
    milkman_id: milkmanId,
    name: 'Ramesh Patel',
    email: 'ramesh@gauamrut.local',
    phone: '9123456780',
    startDate: '2026-01-01',
    cowRatePaise: 6000,
    buffaloRatePaise: 8000,
    morningCowMl: 1000,
    eveningCowMl: 0,
    morningBuffaloMl: 0,
    eveningBuffaloMl: 0,
    routeMorning: 1,
    routeEvening: 1
  });
  customerUser = await User.create({
    email: 'ramesh@gauamrut.local',
    password: 'Password123!',
    role: 'customer',
    milkman_id: milkmanId,
    customer_id: customerDoc._id,
    name: 'Ramesh Patel'
  });
  customerDoc.user_id = customerUser._id;
  await customerDoc.save();
  customerToken = makeToken(customerUser);

  // Create sample bill and delivery
  await Record.create({
    milkman_id: milkmanId,
    customer_id: customerDoc._id,
    date: '2026-08-01',
    shift: 'morning',
    type: 'cow',
    quantityMl: 1000,
    ratePaise: 6000,
    totalPaise: 6000
  });
  testBill = await Bill.create({
    milkman_id: milkmanId,
    customer_id: customerDoc._id,
    month: '2026-08',
    openingPaise: 0,
    chargesPaise: 6000,
    paidPaise: 0,
    closingPaise: 6000
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe('New SRS Features Integration Tests', () => {
  describe('Delivery Adjustments (Vacation & Extra Milk)', () => {
    let adjustmentId;

    it('customer can submit a vacation pause request', async () => {
      const res = await request(app)
        .post('/api/delivery-adjustments')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          type: 'vacation',
          startDate: '2026-09-01',
          endDate: '2026-09-05',
          shift: 'all',
          notes: 'Family vacation'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.type).toBe('vacation');
      adjustmentId = res.body.data._id;
    });

    it('rejects overlapping adjustment requests for the same customer', async () => {
      const res = await request(app)
        .post('/api/delivery-adjustments')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          type: 'vacation',
          startDate: '2026-09-03',
          endDate: '2026-09-08',
          shift: 'all'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OVERLAPPING_ADJUSTMENT');
    });

    it('milkman can list and approve the vacation request', async () => {
      const listRes = await request(app)
        .get('/api/delivery-adjustments')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

      const approveRes = await request(app)
        .patch(`/api/delivery-adjustments/${adjustmentId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: 'approved' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('approved');
    });

    it('active endpoint returns approved vacation for a date within range', async () => {
      const res = await request(app)
        .get('/api/delivery-adjustments/active?date=2026-09-02')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]._id).toBe(adjustmentId);
    });
  });

  describe('In-App Notifications', () => {
    it('creates and lists notifications for user', async () => {
      await createNotification({
        recipient: customerUser._id,
        role: 'customer',
        tenant: milkmanDoc._id,
        type: 'delivery_adjustment',
        title: 'Vacation Approved',
        message: 'Your vacation request was approved.'
      });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.unreadCount).toBeGreaterThanOrEqual(1);

      const notifId = res.body.data[0]._id;
      const markRes = await request(app)
        .patch(`/api/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(markRes.status).toBe(200);
      expect(markRes.body.data.read).toBe(true);
    });

    it('mark all read marks all notifications as read', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('PDF Generation & Additional CSV Reports', () => {
    it('generates PDF invoice buffer for a monthly bill', async () => {
      const res = await request(app)
        .get(`/api/bills/${testBill._id}/pdf`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(500);
    });

    it('exports payments CSV report', async () => {
      const res = await request(app)
        .get('/api/reports/payments.csv?month=2026-08')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('GauAmrut Organic Farm');
      expect(res.text).toContain('Receipt');
    });

    it('exports customer summary CSV report', async () => {
      const res = await request(app)
        .get('/api/reports/customer-summary.csv')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Ramesh Patel');
    });
  });

  describe('Admin Operations & Last Super Admin Safeguard (FR-ADM-03)', () => {
    it('blocks deactivating the last remaining super_admin', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${superAdminUser._id}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ active: false });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
    });

    it('allows toggling non-super-admin user status', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${operationsUser._id}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ active: false });

      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(false);

      // Re-enable
      await request(app)
        .patch(`/api/admin/users/${operationsUser._id}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ active: true });
    });

    it('allows super_admin to update settings', async () => {
      const res = await request(app)
        .put('/api/admin/settings/system')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ payload: { maintenanceMode: false, maxDeliveryBatchSize: 100 } });

      expect(res.status).toBe(200);
      expect(res.body.data.section).toBe('system');
      expect(res.body.data.version).toBe(1);
    });

    it('allows super_admin to toggle dairy verification', async () => {
      const res = await request(app)
        .patch(`/api/admin/dairies/${milkmanDoc._id}/verify`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ verified: true });

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
    });
  });
});

describe('Customers without a phone number', () => {
  const base = { name: 'Leela Ben', email: '', address: '4, Gandhi Road', startDate: '2026-09-01', cowRatePaise: 6000, buffaloRatePaise: 8000, morningCowMl: 1000, eveningCowMl: 500 };
  let phonelessId;

  it('creates a customer whose phone is left empty, exactly like the add-customer form sends', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ ...base, phone: '' });
    expect(res.status).toBe(201);
    expect(res.body.data.phone).toBe('');
    phonelessId = res.body.data._id;
  });

  it('accepts a creation payload that omits the phone field entirely', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send(base);
    expect(res.status).toBe(201);
    expect(res.body.data.phone).toBe('');
  });

  it('lists them in the directory like any other customer', async () => {
    const res = await request(app)
      .get('/api/customers?page=1')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some(c => String(c._id) === String(phonelessId))).toBe(true);
  });

  it('still rejects a malformed phone number', async () => {
    const res = await request(app)
      .put(`/api/customers/${phonelessId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ ...base, status: 'active', phone: 'call-me-maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the dairy add a phone later when the customer gets one', async () => {
    const res = await request(app)
      .put(`/api/customers/${phonelessId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ ...base, status: 'active', phone: '9812345678' });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('9812345678');
    const list = await request(app)
      .get('/api/customers?page=1')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(list.body.data.find(c => String(c._id) === String(phonelessId)).phone).toBe('9812345678');
  });
});
