const request = require('supertest');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'development';
process.env.DEV_SHOW_OTP = 'true';
process.env.JWT_SECRET = '12345678901234567890123456789012';

jest.mock('../src/whatsapp', () => ({
  status: jest.fn(async () => ({ connected: false, phone: null, qr: null })),
  getQr: jest.fn(async () => 'data:image/png;base64,QRDATA'),
  sendText: jest.fn(async () => {}),
  sendDocument: jest.fn(async () => {}),
  disconnect: jest.fn(async () => {}),
  normalizeNumber: jest.fn(n => String(n))
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn(async () => ({ accepted: ['x'] })) }))
}));

const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const { User, Milkman, Customer, VerificationOtp, Notification, Audit } = require('../src/models');
const { AppError } = require('../src/domain');
const whatsapp = require('../src/whatsapp');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

const makeToken = user => jwt.sign({ sv: 0 }, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'gauamrut', algorithm: 'HS256' });

let replSet, app;
let superAdminToken, supportToken;
let customerToken, customerUser, customerDoc, milkmanId;
let nophoneUser, nophoneDoc;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  app = createApp(null);

  const superAdmin = await User.create({ email: 'sa@verify.local', password: 'Password123!', role: 'admin', adminRole: 'super_admin', name: 'Super Admin' });
  superAdminToken = makeToken(superAdmin);
  const support = await User.create({ email: 'support@verify.local', password: 'Password123!', role: 'admin', adminRole: 'support', name: 'Support Admin' });
  supportToken = makeToken(support);

  milkmanId = new mongoose.Types.ObjectId();
  const vendorUser = await User.create({ email: 'dairy@verify.local', password: 'Password123!', role: 'milkman', milkman_id: milkmanId, name: 'Dairy Owner' });
  await Milkman.create({ _id: milkmanId, user_id: vendorUser._id, businessName: 'Verify Dairy', name: 'Dairy Owner', phone: '9800000000', code: 'VERCODE', verified: true });

  customerDoc = await Customer.create({
    milkman_id: milkmanId, name: 'Meera Shah', email: 'meera@example.com', phone: '9876543210',
    startDate: '2026-01-01', cowRatePaise: 6000, buffaloRatePaise: 8000,
    morningCowMl: 1000, eveningCowMl: 0, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: 1, routeEvening: 1
  });
  customerUser = await User.create({ email: 'meera@example.com', password: 'Password123!', role: 'customer', milkman_id: milkmanId, customer_id: customerDoc._id, name: 'Meera Shah' });
  customerDoc.user_id = customerUser._id;
  await customerDoc.save();
  customerToken = makeToken(customerUser);

  nophoneDoc = await Customer.create({
    milkman_id: milkmanId, name: 'No Phone', email: 'nophone@example.com',
    startDate: '2026-01-01', cowRatePaise: 6000, buffaloRatePaise: 8000,
    morningCowMl: 0, eveningCowMl: 0, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: 1, routeEvening: 1
  });
  nophoneUser = await User.create({ email: 'nophone@example.com', password: 'Password123!', role: 'customer', milkman_id: milkmanId, customer_id: nophoneDoc._id, name: 'No Phone' });
  nophoneDoc.user_id = nophoneUser._id;
  await nophoneDoc.save();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(() => {
  process.env.DEV_SHOW_OTP = 'true';
  jest.clearAllMocks();
});

describe('contact verification', () => {
  test('mobile number is verified with a WhatsApp code', async () => {
    const issued = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone' });
    expect(issued.status).toBe(202);
    expect(issued.body.data.developmentOtp).toMatch(/^\d{6}$/);

    const stored = await VerificationOtp.findOne({ customer_id: customerDoc._id, channel: 'phone' }).select('+hash');
    expect(stored).toBeTruthy();
    expect(stored.target).toBe('9876543210');

    const wrong = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone', otp: '000000' });
    expect(wrong.status).toBe(400);

    const confirm = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone', otp: issued.body.data.developmentOtp });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.channel).toBe('phone');

    const updated = await Customer.findById(customerDoc._id).lean();
    expect(updated.phoneVerifiedAt).toBeTruthy();

    const profile = await request(app).get('/api/profile').set('Authorization', `Bearer ${customerToken}`);
    expect(profile.body.data.phoneVerifiedAt).toBeTruthy();

    // The consumed code cannot be replayed
    const replay = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone', otp: issued.body.data.developmentOtp });
    expect(replay.status).toBe(400);
  });

  test('email address is verified with an emailed code', async () => {
    const issued = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email' });
    expect(issued.status).toBe(202);
    const confirm = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email', otp: issued.body.data.developmentOtp });
    expect(confirm.status).toBe(200);
    const updated = await Customer.findById(customerDoc._id).lean();
    expect(updated.emailVerifiedAt).toBeTruthy();
  });

  test('verification requests are rejected without a target contact', async () => {
    const noPhoneToken = makeToken(nophoneUser);
    const phone = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${noPhoneToken}`).send({ channel: 'phone' });
    expect(phone.status).toBe(400);
    expect(phone.body.error.code).toBe('VERIFICATION_TARGET_MISSING');
    expect(await VerificationOtp.countDocuments({ customer_id: nophoneDoc._id })).toBe(0);
  });

  test('attempts are capped at five wrong codes', async () => {
    const issued = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email' });
    const otp = issued.body.data.developmentOtp;
    for (let i = 0; i < 5; i++) {
      const miss = otp === '111111' ? '222222' : '111111';
      const wrong = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email', otp: miss });
      expect(wrong.status).toBe(400);
    }
    const stillGood = await request(app).post('/api/profile/verification/confirm').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email', otp });
    expect(stillGood.status).toBe(400);
  });

  test('changing the mobile number clears its verified flag', async () => {
    await Customer.updateOne({ _id: customerDoc._id }, { $set: { phoneVerifiedAt: new Date() } });
    const vendorToken = makeToken(await User.findOne({ role: 'milkman' }));
    const update = await request(app).put(`/api/customers/${customerDoc._id}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        name: 'Meera Shah', email: 'meera@example.com', phone: '9000000001',
        startDate: '2026-01-01', status: 'active',
        cowRatePaise: 6000, buffaloRatePaise: 8000,
        morningCowMl: 1000, eveningCowMl: 0, morningBuffaloMl: 0, eveningBuffaloMl: 0, routeMorning: 1, routeEvening: 1
      });
    expect(update.status).toBe(200);
    const updated = await Customer.findById(customerDoc._id).lean();
    expect(updated.phoneVerifiedAt).toBe(null);
    // Restore the original number for the remaining tests
    await Customer.updateOne({ _id: customerDoc._id }, { $set: { phone: '9876543210' } });
  });

  test('phone codes are actually sent over WhatsApp when not in dev mode', async () => {
    process.env.DEV_SHOW_OTP = 'false';
    try {
      const issued = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone' });
      expect(issued.status).toBe(202);
      expect(issued.body.data.developmentOtp).toBeUndefined();
      expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
      const [number, text] = whatsapp.sendText.mock.calls[0];
      expect(number).toBe('9876543210');
      expect(text).toMatch(/verification code is \d{6}/);

      // A WhatsApp outage leaves no stale code behind
      whatsapp.sendText.mockRejectedValueOnce(new AppError(503, 'WHATSAPP_UNAVAILABLE', 'down'));
      const failed = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'phone' });
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('WHATSAPP_UNAVAILABLE');
      // Deliberate 5xxs carry the instruction the caller needs; only genuine
      // failures are hidden behind the generic retry notice.
      expect(failed.body.error.message).toBe('down');
    } finally {
      process.env.DEV_SHOW_OTP = 'true';
    }
  });

  test('email codes go out through SMTP when not in dev mode', async () => {
    process.env.DEV_SHOW_OTP = 'false';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    process.env.SMTP_FROM = 'noreply@example.com';
    try {
      const issued = await request(app).post('/api/profile/verification/request').set('Authorization', `Bearer ${customerToken}`).send({ channel: 'email' });
      expect(issued.status).toBe(202);
      expect(nodemailer.createTransport).toHaveBeenCalled();
    } finally {
      process.env.DEV_SHOW_OTP = 'true';
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.SMTP_FROM;
    }
  });
});

describe('admin verification requests', () => {
  test('admin sends a verification request that delivers codes and notifies the customer', async () => {
    const res = await request(app).post(`/api/admin/users/${customerUser._id}/verification-request`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ channels: ['phone', 'email'] });
    expect(res.status).toBe(200);
    expect(res.body.data.delivered).toEqual(['phone', 'email']);

    const notif = await Notification.findOne({ recipient: customerUser._id, type: 'verification' }).lean();
    expect(notif).toBeTruthy();
    expect(notif.link).toBe('/profile');

    const audit = await Audit.findOne({ action: 'admin.customer.verification.requested' }).lean();
    expect(audit).toBeTruthy();
  });

  test('channels without a target are reported as skipped', async () => {
    const res = await request(app).post(`/api/admin/users/${nophoneUser._id}/verification-request`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ channels: ['phone', 'email'] });
    expect(res.status).toBe(200);
    expect(res.body.data.delivered).toEqual(['email']);
    expect(res.body.data.skipped).toEqual([{ channel: 'phone', reason: 'NO_MOBILE' }]);
  });

  test('requests only work for customer accounts and require permission', async () => {
    const vendor = await User.findOne({ role: 'milkman' });
    const notCustomer = await request(app).post(`/api/admin/users/${vendor._id}/verification-request`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ channels: ['email'] });
    expect(notCustomer.status).toBe(409);

    const forbidden = await request(app).post(`/api/admin/users/${customerUser._id}/verification-request`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ channels: ['email'] });
    expect(forbidden.status).toBe(403);
  });
});

describe('WhatsApp document sharing and admin connection', () => {
  const pdfBase64 = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]).toString('base64');

  test('any signed-in user can send a generated PDF to a WhatsApp number', async () => {
    const res = await request(app).post('/api/whatsapp/send-document')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ number: '+91 98765 43210', fileName: 'bill-2026-10.pdf', caption: 'Monthly bill', pdfBase64: pdfBase64() });
    expect(res.status).toBe(200);
    expect(whatsapp.sendDocument).toHaveBeenCalledTimes(1);
    const [number, buffer, fileName, caption] = whatsapp.sendDocument.mock.calls[0];
    expect(number).toBe('+91 98765 43210');
    expect(buffer.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fileName).toBe('bill-2026-10.pdf');
    expect(caption).toBe('Monthly bill');
  });

  test('non-PDF payloads and missing auth are rejected', async () => {
    const bad = await request(app).post('/api/whatsapp/send-document')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ number: '9876543210', fileName: 'x.pdf', caption: '', pdfBase64: Buffer.from('not a pdf at all').toString('base64') });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PDF');

    const anon = await request(app).post('/api/whatsapp/send-document')
      .send({ number: '9876543210', fileName: 'x.pdf', caption: '', pdfBase64: pdfBase64() });
    expect(anon.status).toBe(401);
  });

  test('a WhatsApp outage surfaces a clear error', async () => {
    whatsapp.sendDocument.mockRejectedValueOnce(new AppError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp is not connected yet.'));
    const res = await request(app).post('/api/whatsapp/send-document')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ number: '9876543210', fileName: 'x.pdf', caption: '', pdfBase64: pdfBase64() });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('WHATSAPP_UNAVAILABLE');
  });

  test('admins can manage the WhatsApp connection', async () => {
    const status = await request(app).get('/api/admin/whatsapp/status').set('Authorization', `Bearer ${superAdminToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual({ connected: false, phone: null, qr: null });

    const qr = await request(app).post('/api/admin/whatsapp/qr').set('Authorization', `Bearer ${superAdminToken}`);
    expect(qr.status).toBe(200);
    expect(qr.body.data.qr).toBe('data:image/png;base64,QRDATA');

    whatsapp.getQr.mockResolvedValueOnce(null);
    const connected = await request(app).post('/api/admin/whatsapp/qr').set('Authorization', `Bearer ${superAdminToken}`);
    expect(connected.status).toBe(409);

    const off = await request(app).post('/api/admin/whatsapp/disconnect').set('Authorization', `Bearer ${superAdminToken}`);
    expect(off.status).toBe(200);
    expect(whatsapp.disconnect).toHaveBeenCalled();

    const forbidden = await request(app).get('/api/admin/whatsapp/status').set('Authorization', `Bearer ${supportToken}`);
    expect(forbidden.status).toBe(403);
  });

  test('the dairy directory exports as a PDF for admins', async () => {
    const res = await request(app).get('/api/admin/dairies.pdf').set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
