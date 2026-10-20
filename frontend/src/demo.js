import { serviceDate } from './lib';
const names = ['Meera Shah', 'Rajesh Patel', 'Priya Desai', 'Amit Joshi', 'Kavita Mehta', 'Rohan Trivedi', 'Nisha Parmar', 'Suresh Shah'];
export const demoCustomers = names.map((name, i) => ({ _id: `demo-${i}`, name, phone: `98765 4321${i}`, address: ['12, Green Park Society', '8, Shanti Residency', '24, Sunrise Apartments', '5, Vrindavan Society'][i % 4], status: i === 7 ? 'inactive' : 'active', cowRatePaise: 6000, buffaloRatePaise: 8000, morningCowMl: i % 3 === 0 ? 1500 : 1000, eveningCowMl: 500, morningBuffaloMl: 0, eveningBuffaloMl: 0, startDate: '2026-01-01', routeMorning: i }));
export const demoRecords = demoCustomers.slice(0, 6).map((c, i) => ({ _id: `r${i}`, customer_id: c._id, customerName: c.name, date: serviceDate(), shift: 'morning', type: i === 2 ? 'buffalo' : 'cow', quantityMl: c.morningCowMl, totalPaise: c.morningCowMl * 6, ratePaise: 6000 }));
export const demoDashboard = { date: serviceDate(), customerCount: 8, activeCustomers: 7, today: { quantityMl: 7500, totalPaise: 45000, entries: 6 }, outstandingPaise: 128000, collectedPaise: 964000, recent: demoRecords, monthly: Array.from({ length: 7 }, (_, i) => ({ _id: `${serviceDate().slice(0, 7)}-${String(i + 1).padStart(2, '0')}`, quantityMl: [6500, 8000, 7000, 9500, 8500, 10000, 7500][i], totalPaise: [39000, 48000, 42000, 57000, 51000, 60000, 45000][i] })) };
export const demoBills = demoCustomers.slice(0, 4).map((c, i) => ({ _id: `b${i}`, customer_id: c._id, month: '2026-08', openingPaise: i === 0 ? 20000 : 0, chargesPaise: 180000, paidPaise: i === 0 ? 52000 : 180000, closingPaise: i === 0 ? 148000 : 0 }));
export const demoClaims = [
  { _id: 'c1', customer_id: 'demo-0', customerName: 'Meera Shah', amountPaise: 50000, method: 'upi', reference: 'UPI20260914001', notes: 'GPay payment', status: 'pending', createdAt: new Date().toISOString() },
  { _id: 'c2', customer_id: 'demo-1', customerName: 'Rajesh Patel', amountPaise: 180000, method: 'bank', reference: 'NEFT99887766', notes: 'Bank transfer', status: 'approved', createdAt: new Date().toISOString() }
];
export const demoAdjustments = [
  { _id: 'adj1', customer_id: 'demo-0', customerName: 'Meera Shah', billMonth: '2026-08', type: 'waiver', amountPaise: 12000, reason: 'Goodwill discount for late morning delivery', status: 'applied', createdAt: new Date().toISOString() },
  { _id: 'adj2', customer_id: 'demo-1', customerName: 'Rajesh Patel', billMonth: '2026-08', type: 'credit', amountPaise: 8000, reason: 'Adjustment for missed delivery on 15th', status: 'applied', createdAt: new Date().toISOString() }
];
export const demoPayments = [
  { _id: 'p1', customer_id: 'demo-0', customerName: 'Meera Shah', amountPaise: 52000, method: 'upi', reference: 'UPI20260901001', receipt: 'GA-DEMO-2026-001', reversed: false, createdAt: new Date().toISOString() },
  { _id: 'p2', customer_id: 'demo-1', customerName: 'Rajesh Patel', amountPaise: 180000, method: 'bank', reference: 'NEFT99887766', receipt: 'GA-DEMO-2026-002', reversed: false, createdAt: new Date().toISOString() }
];

export const demoProducts = [
  { _id: 'prod-1', name: 'Gir Cow A2 Desi Ghee 500ml', type: 'ghee', unit: 'piece', pricePaise: 65000, description: 'Traditional bilona churned A2 Gir cow cultured ghee.', available: true, deleted: false },
  { _id: 'prod-2', name: 'Fresh Malai Paneer 250g', type: 'paneer', unit: 'pack', pricePaise: 12000, description: 'Soft, unpressed malai paneer made daily.', available: true, deleted: false },
  { _id: 'prod-3', name: 'Farm Curd (Dahi) 500g', type: 'curd', unit: 'pack', pricePaise: 5000, description: 'Naturally set thick earthen pot curd.', available: true, deleted: false },
  { _id: 'prod-4', name: 'White Makkhan (Butter) 200g', type: 'butter', unit: 'pack', pricePaise: 18000, description: 'Unsalted traditional hand-churned white butter.', available: false, deleted: false }
];

export const demoOrders = [
  {
    _id: 'ord-1',
    customer_id: 'demo-0',
    customerName: 'Meera Shah',
    customerPhone: '98765 43210',
    deliveryDate: serviceDate(),
    shift: 'morning',
    status: 'placed',
    notes: 'Please pack in paper bag',
    totalPaise: 24000,
    items: [
      { product_id: 'prod-2', name: 'Fresh Malai Paneer 250g', unit: 'pack', unitPricePaise: 12000, quantity: 2, totalPaise: 24000 }
    ],
    createdAt: new Date().toISOString()
  },
  {
    _id: 'ord-2',
    customer_id: 'demo-1',
    customerName: 'Rajesh Patel',
    customerPhone: '98765 43211',
    deliveryDate: serviceDate(),
    shift: 'evening',
    status: 'confirmed',
    notes: '',
    totalPaise: 65000,
    items: [
      { product_id: 'prod-1', name: 'Gir Cow A2 Desi Ghee 500ml', unit: 'piece', unitPricePaise: 65000, quantity: 1, totalPaise: 65000 }
    ],
    createdAt: new Date().toISOString()
  }
];

export const demoDisputes = [
  {
    _id: 'dsp-1',
    customer_id: 'demo-0',
    customerName: 'Meera Shah',
    customerPhone: '98765 43210',
    type: 'quantity_mismatch',
    targetType: 'delivery',
    title: 'Morning cow milk was 500ml instead of 1L',
    description: 'We received one pouch today morning instead of two.',
    status: 'under_review',
    createdAt: new Date().toISOString(),
    replies: [
      { actor: 'demo-0', role: 'customer', authorName: 'Meera Shah', message: 'We received one pouch today morning instead of two.', createdAt: new Date().toISOString() },
      { actor: 'owner', role: 'milkman', authorName: 'Dairy Owner', message: 'Checking with our delivery route person right now.', createdAt: new Date().toISOString() }
    ]
  }
];


