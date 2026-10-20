const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const models = require('../src/models');
const { createApp } = require('../src/app');

let replica, app;
let dairyIdA, ownerA, tokenA, customerDocA, customerUserA, customerTokenA;
let dairyIdB, ownerB, tokenB, customerDocB, customerUserB, customerTokenB;

const token = user => jwt.sign({}, process.env.JWT_SECRET, { subject: String(user._id), issuer: 'gauamrut', expiresIn: '1h' });
const get = (path, t = tokenA) => request(app).get('/api' + path).set('Authorization', `Bearer ${t}`);
const post = (path, body, t = tokenA) => request(app).post('/api' + path).set('Authorization', `Bearer ${t}`).send(body);
const patch = (path, body, t = tokenA) => request(app).patch('/api' + path).set('Authorization', `Bearer ${t}`).send(body);
const del = (path, t = tokenA) => request(app).delete('/api' + path).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-commerce-secret-32-chars-long-gauamrut';
  process.env.NODE_ENV = 'development';
  let systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
  if (!systemBinary) {
    try {
      systemBinary = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['mongod'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    } catch {
      /* fallback */
    }
  }
  replica = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, version: process.env.MONGOMS_VERSION || '8.0.28' } : { version: '8.0.28' },
    replSet: { count: 1, storageEngine: 'wiredTiger' }
  });
  await mongoose.connect(replica.getUri('gauamrut_commerce_test'));
  await Promise.all(Object.values(models).map(m => m.init()));
  app = createApp();
});

beforeEach(async () => {
  app = createApp();
  await Promise.all(Object.values(models).map(m => m.deleteMany({})));

  // Dairy A
  dairyIdA = new mongoose.Types.ObjectId();
  ownerA = await models.User.create({
    email: 'dairy-a@example.com',
    name: 'Dairy Owner A',
    password: 'password-hash',
    role: 'milkman',
    milkman_id: dairyIdA
  });
  await models.Milkman.create({
    _id: dairyIdA,
    user_id: ownerA._id,
    businessName: 'Gau Amrut Dairy A',
    name: 'Owner A',
    phone: '9825000001',
    upiId: 'dairyA@upi',
    code: 'DAIRYA01'
  });
  customerDocA = await models.Customer.create({
    name: 'Customer A1',
    phone: '9876500001',
    address: 'Street 1, Ahmedabad',
    startDate: '2025-01-01',
    cowRatePaise: 6000,
    buffaloRatePaise: 8000,
    morningCowMl: 1000,
    eveningCowMl: 0,
    morningBuffaloMl: 0,
    eveningBuffaloMl: 0,
    routeMorning: 1,
    routeEvening: 1,
    milkman_id: dairyIdA
  });
  customerUserA = await models.User.create({
    email: 'customera1@example.com',
    name: 'Customer A1',
    password: 'password-hash',
    role: 'customer',
    milkman_id: dairyIdA,
    customer_id: customerDocA._id
  });
  await models.Customer.updateOne({ _id: customerDocA._id }, { user_id: customerUserA._id });

  // Dairy B (for multi-tenant isolation testing)
  dairyIdB = new mongoose.Types.ObjectId();
  ownerB = await models.User.create({
    email: 'dairy-b@example.com',
    name: 'Dairy Owner B',
    password: 'password-hash',
    role: 'milkman',
    milkman_id: dairyIdB
  });
  await models.Milkman.create({
    _id: dairyIdB,
    user_id: ownerB._id,
    businessName: 'Shree Krishna Dairy B',
    name: 'Owner B',
    phone: '9825000002',
    upiId: 'dairyB@upi',
    code: 'DAIRYB02'
  });
  customerDocB = await models.Customer.create({
    name: 'Customer B1',
    phone: '9876500002',
    address: 'Street 2, Surat',
    startDate: '2025-01-01',
    cowRatePaise: 6000,
    buffaloRatePaise: 8000,
    morningCowMl: 1000,
    eveningCowMl: 0,
    morningBuffaloMl: 0,
    eveningBuffaloMl: 0,
    routeMorning: 1,
    routeEvening: 1,
    milkman_id: dairyIdB
  });
  customerUserB = await models.User.create({
    email: 'customerb1@example.com',
    name: 'Customer B1',
    password: 'password-hash',
    role: 'customer',
    milkman_id: dairyIdB,
    customer_id: customerDocB._id
  });
  await models.Customer.updateOne({ _id: customerDocB._id }, { user_id: customerUserB._id });

  tokenA = token(ownerA);
  customerTokenA = token(customerUserA);
  tokenB = token(ownerB);
  customerTokenB = token(customerUserB);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

describe('Product Catalogue (FR-PRD-01)', () => {
  test('Vendor can create products and list them', async () => {
    const res = await post('/products', {
      name: 'Organic Paneer 250g',
      type: 'paneer',
      unit: 'pack',
      pricePaise: 12000, // ₹120.00
      description: 'Fresh farm-made malai paneer'
    }, tokenA);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Organic Paneer 250g');
    expect(res.body.data.pricePaise).toBe(12000);
    expect(res.body.data.available).toBe(true);

    const listRes = await get('/products', tokenA);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].name).toBe('Organic Paneer 250g');
  });

  test('Customer sees only connected vendor products and only available ones', async () => {
    // Dairy A creates 2 products: 1 available, 1 unavailable
    const p1 = await post('/products', {
      name: 'Gir Cow Ghee 500ml',
      type: 'ghee',
      unit: 'piece',
      pricePaise: 65000,
      available: true
    }, tokenA);
    expect(p1.status).toBe(201);

    const p2 = await post('/products', {
      name: 'Fresh Curd 500g',
      type: 'curd',
      unit: 'pack',
      pricePaise: 5000,
      available: false
    }, tokenA);
    expect(p2.status).toBe(201);

    // Dairy B creates a product
    const pB = await post('/products', {
      name: 'Dairy B Butter 100g',
      type: 'butter',
      unit: 'pack',
      pricePaise: 6000,
      available: true
    }, tokenB);
    expect(pB.status).toBe(201);

    // Customer A checks products: should only see Gir Cow Ghee (available)
    const custRes = await get('/products', customerTokenA);
    expect(custRes.status).toBe(200);
    expect(custRes.body.data).toHaveLength(1);
    expect(custRes.body.data[0].name).toBe('Gir Cow Ghee 500ml');

    // Vendor A checks products: sees both available and unavailable
    const vendorRes = await get('/products', tokenA);
    expect(vendorRes.status).toBe(200);
    expect(vendorRes.body.data).toHaveLength(2);
  });

  test('Vendor can update product details and soft-delete product', async () => {
    const created = await post('/products', {
      name: 'A2 Cow Milk 1L',
      type: 'milk',
      unit: 'L',
      pricePaise: 7500
    }, tokenA);

    const prodId = created.body.data._id;

    // Update
    const updateRes = await patch(`/products/${prodId}`, {
      pricePaise: 8000,
      description: 'Glass bottled raw milk'
    }, tokenA);
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.pricePaise).toBe(8000);
    expect(updateRes.body.data.description).toBe('Glass bottled raw milk');

    // Delete (soft)
    const delRes = await del(`/products/${prodId}`, tokenA);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);

    // Product should no longer appear in listing
    const listRes = await get('/products', tokenA);
    expect(listRes.body.data.find(p => p._id === prodId)).toBeUndefined();
  });
});

describe('Price-Snapshot Orders (FR-PRD-02)', () => {
  test('Order snapshots product prices and remains unchanged when catalogue prices change', async () => {
    // 1. Create products
    const p1 = await post('/products', {
      name: 'Paneer 250g',
      type: 'paneer',
      unit: 'pack',
      pricePaise: 10000 // ₹100
    }, tokenA);
    const p2 = await post('/products', {
      name: 'Desi Ghee 1L',
      type: 'ghee',
      unit: 'piece',
      pricePaise: 90000 // ₹900
    }, tokenA);

    // 2. Customer places order: 2 Paneer + 1 Ghee
    const orderRes = await post('/orders', {
      deliveryDate: '2025-06-15',
      shift: 'morning',
      items: [
        { product_id: p1.body.data._id, quantity: 2 },
        { product_id: p2.body.data._id, quantity: 1 }
      ],
      notes: 'Please ring doorbell'
    }, customerTokenA);

    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;
    expect(order.status).toBe('placed');
    expect(order.totalPaise).toBe(2 * 10000 + 1 * 90000); // 110000 (₹1,100)
    expect(order.items).toHaveLength(2);
    expect(order.items[0].unitPricePaise).toBe(10000);
    expect(order.items[0].name).toBe('Paneer 250g');
    expect(order.items[1].unitPricePaise).toBe(90000);

    // 3. Vendor now increases catalogue prices
    await patch(`/products/${p1.body.data._id}`, { pricePaise: 15000 }, tokenA);
    await patch(`/products/${p2.body.data._id}`, { pricePaise: 120000 }, tokenA);

    // 4. Retrieve order: price snapshot must remain identical!
    const ordersList = await get('/orders', customerTokenA);
    expect(ordersList.status).toBe(200);
    const fetched = ordersList.body.data.find(o => o._id === order._id);
    expect(fetched.totalPaise).toBe(110000);
    expect(fetched.items[0].unitPricePaise).toBe(10000);
    expect(fetched.items[1].unitPricePaise).toBe(90000);
  });

  test('Order lifecycle state machine: placed -> confirmed -> fulfilled', async () => {
    const prod = await post('/products', {
      name: 'Cow Butter 200g',
      type: 'butter',
      unit: 'pack',
      pricePaise: 18000
    }, tokenA);

    const orderRes = await post('/orders', {
      deliveryDate: '2025-06-16',
      items: [{ product_id: prod.body.data._id, quantity: 1 }]
    }, customerTokenA);
    const orderId = orderRes.body.data._id;

    // Vendor confirms order
    const confirmRes = await patch(`/orders/${orderId}/status`, { status: 'confirmed' }, tokenA);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe('confirmed');

    // Vendor fulfills order
    const fulfillRes = await patch(`/orders/${orderId}/status`, { status: 'fulfilled' }, tokenA);
    expect(fulfillRes.status).toBe(200);
    expect(fulfillRes.body.data.status).toBe('fulfilled');
    expect(fulfillRes.body.data.fulfilledAt).toBeDefined();

    // Cannot change status from fulfilled (terminal)
    const invalidRes = await patch(`/orders/${orderId}/status`, { status: 'cancelled', reason: 'Too late' }, tokenA);
    expect(invalidRes.status).toBe(409);
    expect(invalidRes.body.error.code).toBe('INVALID_ORDER_STATE');
  });

  test('Customer can cancel placed order with reason, but not after confirmation', async () => {
    const prod = await post('/products', {
      name: 'Fresh Dahi 1kg',
      type: 'curd',
      unit: 'kg',
      pricePaise: 8000
    }, tokenA);

    // Order 1: Cancel while placed
    const order1 = await post('/orders', {
      deliveryDate: '2025-06-17',
      items: [{ product_id: prod.body.data._id, quantity: 1 }]
    }, customerTokenA);

    const cancel1 = await patch(`/orders/${order1.body.data._id}/status`, {
      status: 'cancelled',
      reason: 'Out of town on delivery date'
    }, customerTokenA);
    expect(cancel1.status).toBe(200);
    expect(cancel1.body.data.status).toBe('cancelled');
    expect(cancel1.body.data.cancellationReason).toBe('Out of town on delivery date');

    // Order 2: Try to cancel after confirmed
    const order2 = await post('/orders', {
      deliveryDate: '2025-06-18',
      items: [{ product_id: prod.body.data._id, quantity: 1 }]
    }, customerTokenA);
    await patch(`/orders/${order2.body.data._id}/status`, { status: 'confirmed' }, tokenA);

    const cancel2 = await patch(`/orders/${order2.body.data._id}/status`, {
      status: 'cancelled',
      reason: 'Need to cancel'
    }, customerTokenA);
    expect(cancel2.status).toBe(409);
    expect(cancel2.body.error.code).toBe('INVALID_ORDER_STATE');
  });

  test('Vendor can cancel placed or confirmed order with reason', async () => {
    const prod = await post('/products', {
      name: 'Paneer 500g',
      type: 'paneer',
      unit: 'pack',
      pricePaise: 20000
    }, tokenA);

    const order = await post('/orders', {
      deliveryDate: '2025-06-19',
      items: [{ product_id: prod.body.data._id, quantity: 1 }]
    }, customerTokenA);

    const cancelRes = await patch(`/orders/${order.body.data._id}/status`, {
      status: 'cancelled',
      reason: 'Out of stock for this delivery slot'
    }, tokenA);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');
    expect(cancelRes.body.data.cancellationReason).toBe('Out of stock for this delivery slot');
  });
});

describe('Disputes & Threaded Replies (FR-DSP-01, FR-DSP-02)', () => {
  test('Customer creates dispute, vendor replies (auto moves to under_review), vendor resolves', async () => {
    // 1. Customer creates dispute
    const disputeRes = await post('/disputes', {
      type: 'quantity_mismatch',
      targetType: 'delivery',
      title: 'Received 500ml instead of 1000ml',
      description: 'On June 14th morning shift, bottle was half filled.'
    }, customerTokenA);

    expect(disputeRes.status).toBe(201);
    const dispute = disputeRes.body.data;
    expect(dispute.status).toBe('open');
    expect(dispute.replies).toHaveLength(1);
    expect(dispute.replies[0].role).toBe('customer');

    // 2. Vendor views disputes list
    const listRes = await get('/disputes', tokenA);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].customerName).toBe('Customer A1');

    // 3. Vendor replies -> auto-advances to under_review
    const replyRes = await post(`/disputes/${dispute._id}/replies`, {
      message: 'Checking with our delivery partner for June 14th morning shift.'
    }, tokenA);
    expect(replyRes.status).toBe(200);
    expect(replyRes.body.data.status).toBe('under_review');
    expect(replyRes.body.data.replies).toHaveLength(2);
    expect(replyRes.body.data.replies[1].role).toBe('milkman');

    // 4. Customer adds a follow-up reply
    const custReplyRes = await post(`/disputes/${dispute._id}/replies`, {
      message: 'Thank you for looking into this.'
    }, customerTokenA);
    expect(custReplyRes.status).toBe(200);
    expect(custReplyRes.body.data.replies).toHaveLength(3);

    // 5. Vendor resolves with resolutionNotes
    const resolveRes = await patch(`/disputes/${dispute._id}/status`, {
      status: 'resolved',
      resolutionNotes: 'Verified missing 500ml and issued credit adjustment.'
    }, tokenA);
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data.status).toBe('resolved');
    expect(resolveRes.body.data.resolutionNotes).toBe('Verified missing 500ml and issued credit adjustment.');
    expect(resolveRes.body.data.resolvedAt).toBeDefined();

    // 6. Closed dispute cannot accept further replies
    const postClosedReply = await post(`/disputes/${dispute._id}/replies`, {
      message: 'Should fail'
    }, customerTokenA);
    expect(postClosedReply.status).toBe(409);
    expect(postClosedReply.body.error.code).toBe('DISPUTE_CLOSED');
  });

  test('Cross-tenant isolation: Customer B cannot view or reply to Customer A dispute', async () => {
    const disputeRes = await post('/disputes', {
      type: 'billing',
      title: 'Incorrect bill total',
      description: 'May bill shows extra delivery charges.'
    }, customerTokenA);
    const disputeId = disputeRes.body.data._id;

    // Customer B attempts to get Customer A's dispute
    const crossGet = await get(`/disputes/${disputeId}`, customerTokenB);
    expect(crossGet.status).toBe(404); // Dairy B tenant cannot find Dairy A dispute

    // Customer B attempts to reply to Customer A's dispute
    const crossReply = await post(`/disputes/${disputeId}/replies`, {
      message: 'Intruder message'
    }, customerTokenB);
    expect(crossReply.status).toBe(404);
  });
});
