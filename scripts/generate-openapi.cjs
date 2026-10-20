// Keep the versioned API contract reproducible alongside route changes.
const fs = require('node:fs');
const path = require('node:path');
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const str = { type: 'string' }, id = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };
const paise = { type: 'integer', minimum: 0, description: 'INR minor units (100 paise = ₹1)' };
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const customerFields = { name: str, phone: str, email: { type: 'string', format: 'email' }, address: str, startDate: { type: 'string', format: 'date' }, endDate: str, cowRatePaise: paise, buffaloRatePaise: paise, morningCowMl: { type: 'integer', minimum: 0 }, eveningCowMl: { type: 'integer', minimum: 0 }, morningBuffaloMl: { type: 'integer', minimum: 0 }, eveningBuffaloMl: { type: 'integer', minimum: 0 }, routeMorning: { type: 'integer', minimum: 0 }, routeEvening: { type: 'integer', minimum: 0 } };
const schemas = {
  Error: object({ error: object({ code: str, message: str }, ['code', 'message']) }, ['error']),
  Register: object({ name: str, businessName: str, phone: str, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8, maxLength: 72, writeOnly: true } }, ['name', 'businessName', 'phone', 'email', 'password']),
  Login: object({ email: { type: 'string', format: 'email' }, password: { type: 'string', writeOnly: true } }, ['email', 'password']),
  Verify: object({ email: { type: 'string', format: 'email' }, otp: { type: 'string', pattern: '^\\d{6}$', writeOnly: true } }, ['email', 'otp']),
  Identity: object({ id, name: str, email: str, role: { enum: ['milkman', 'customer'] }, milkman_id: id, customer_id: id, businessName: str, code: str }),
  Session: object({ token: str, user: ref('Identity') }, ['token', 'user']),
  RegistrationResult: object({ message: str, developmentOtp: { type: 'string', description: 'Only returned when NODE_ENV=development and DEV_SHOW_OTP=true' } }),
  CustomerCreate: object(customerFields, ['name', 'phone', 'startDate', 'cowRatePaise', 'buffaloRatePaise']),
  Customer: object({ ...customerFields, _id: id, milkman_id: id, status: { enum: ['active', 'inactive'] }, language: str, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, __v: { type: 'integer' } }),
  DeliveryInput: object({ customer_id: id, date: { type: 'string', format: 'date' }, shift: { enum: ['morning', 'evening'] }, type: { enum: ['cow', 'buffalo'] }, quantityMl: { type: 'integer', minimum: 0, maximum: 100000 } }, ['customer_id', 'date', 'shift', 'type', 'quantityMl']),
  DeliveryBatch: object({ items: { type: 'array', minItems: 1, maxItems: 100, items: ref('DeliveryInput') } }, ['items']),
  Delivery: object({ _id: id, milkman_id: id, customer_id: id, date: { type: 'string', format: 'date' }, shift: str, type: str, quantityMl: { type: 'integer' }, ratePaise: paise, totalPaise: paise, deleted: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, __v: { type: 'integer' } }),
  BillCreate: object({ customer_id: id, month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }, ['customer_id', 'month']),
  Bill: object({ _id: id, milkman_id: id, customer_id: id, month: str, openingPaise: paise, chargesPaise: paise, paidPaise: paise, closingPaise: paise, currency: { const: 'INR' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, __v: { type: 'integer' } }),
  PaymentCreate: object({ bill_id: id, amountPaise: { ...paise, minimum: 1, maximum: 1000000 }, method: { enum: ['cash', 'upi', 'bank'] }, reference: { type: 'string', minLength: 3, maxLength: 100, description: 'Required for UPI and bank transfers; globally unique.' } }, ['bill_id', 'amountPaise', 'method']),
  Payment: object({ _id: id, milkman_id: id, customer_id: id, bill_id: id, amountPaise: paise, currency: { const: 'INR' }, method: str, reference: str, receipt: str, deleted: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, __v: { type: 'integer' } }),
  StatusChange: object({ status: { enum: ['active', 'inactive'] } }, ['status']),
  Health: object({ status: str, database: { type: 'boolean' }, redis: { type: ['boolean', 'string'] } }),
  Dashboard: { type: 'object', description: 'Tenant-scoped customer counts, today (quantityMl, totalPaise, entries), monthly daily totals, outstandingPaise, collectedPaise, businessName and six recent deliveries. Customer accounts receive only their own data.', properties: { date: { type: 'string', format: 'date' }, customerCount: { type: 'integer' }, activeCustomers: { type: 'integer' }, outstandingPaise: paise, collectedPaise: paise, businessName: str, today: object({ quantityMl: { type: 'integer' }, totalPaise: paise, entries: { type: 'integer' }, _id: { type: 'null' } }), monthly: { type: 'array', items: object({ _id: str, totalPaise: paise, quantityMl: { type: 'integer' } }) }, recent: { type: 'array', items: { allOf: [ref('Delivery')], description: 'Also includes customerName.' } } } }
};
const page = [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }];
schemas.Customer.properties.user_id = id;
schemas.CustomerUpdate = object({ ...customerFields, status: { enum: ['active', 'inactive'] } }, ['name', 'phone', 'startDate', 'cowRatePaise', 'buffaloRatePaise', 'status']);
schemas.CustomerRegistration = object({ name: str, email: { type: 'string', format: 'email' }, password: schemas.Register.properties.password, phone: str, code: { type: 'string', pattern: '^[A-Za-z0-9]{8}$' }, address: str, language: { enum: ['en', 'hi', 'gu'] } }, ['name', 'email', 'password', 'phone', 'code']);
schemas.DairyCode = object({ code: { type: 'string', pattern: '^[A-Za-z0-9]{8}$' } }, ['code']);
schemas.DairyIdentity = object({ businessName: str, code: str }, ['businessName', 'code']);
schemas.Onboarding = object({ onboardingRequired: { const: true }, onboardingToken: { type: 'string', description: 'Short-lived bearer capability. Keep in memory; never log it.' }, businessName: str, historyCandidates: { type: 'array', maxItems: 20, items: object({ _id: id, name: str, startDate: { type: 'string', format: 'date' } }) } }, ['onboardingRequired', 'onboardingToken', 'businessName', 'historyCandidates']);
schemas.VerificationResult = { oneOf: [ref('Session'), ref('Onboarding')] };
schemas.CustomerComplete = { oneOf: [object({ onboardingToken: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, claimCustomerId: id }, ['onboardingToken', 'claimCustomerId']), object({ onboardingToken: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, createNew: { const: true } }, ['onboardingToken', 'createNew'])] };
schemas.CustomerSelfUpdate = object({ name: { type: 'string', minLength: 2, maxLength: 100 }, address: { type: 'string', maxLength: 300 }, language: { enum: ['en', 'hi', 'gu'] } }, ['name', 'address', 'language']);
schemas.DairyProfile = object({ _id: id, user_id: id, businessName: str, name: str, phone: str, upiId: str, code: str, verified: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, __v: { type: 'integer' } });
schemas.Profile = { oneOf: [ref('Customer'), ref('DairyProfile')] };
schemas.LogoutResult = object({ message: str }, ['message']);
schemas.Identity.properties.role = { enum: ['milkman', 'customer', 'admin'] };
schemas.Identity.properties.adminRole = { enum: ['super_admin', 'operations', 'finance', 'support'] };
schemas.Identity.properties.permissions = { type: 'array', items: { type: 'string' } };
schemas.AdminDashboard = object({ users: { type: 'integer' }, dairies: { type: 'integer' }, customers: { type: 'integer' }, activeUsers: { type: 'integer' }, deliveries: { type: 'integer' } });
schemas.AdminUser = object({ _id: id, name: str, email: str, role: str, adminRole: str, active: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } });
schemas.AdminDairy = object({ _id: id, businessName: str, name: str, phone: str, verified: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } });
schemas.AdminActivity = object({ _id: id, actor: id, action: str, target: str, milkman_id: id, requestId: str, createdAt: { type: 'string', format: 'date-time' } });
const paths = {};
function endpoint(url, method, summary, options = {}) {
  const { body, result, list = false, public: isPublic = false, vendor = false, idempotent = false, status = 200, parameters = [], description = '' } = options;
  const parametersAll = [...parameters];
  if (idempotent) parametersAll.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[\\w-]{8,128}$' }, description: 'Persist across retries. Reuse with changed content returns 409.' });
  const response = result ? { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: list ? { type: 'array', items: ref(result) } : ref(result), meta: { type: 'object', properties: { total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } } } } : { type: 'string' };
  const errors = Object.fromEntries([400, 401, 403, 404, 409, 422, 429, 500, 503].map(code => [code, { description: ({ 400: 'Validation failure', 401: 'Missing, expired or inactive-user session', 403: 'Role or origin denied', 404: 'Resource absent in authenticated scope', 409: 'Duplicate, idempotency conflict, closed period, or invalid ledger operation', 422: 'Export exceeds synchronous row limit', 429: 'Authentication rate limit reached', 500: 'Internal failure', 503: 'Dependency unavailable' })[code], content: { 'application/json': { schema: ref('Error') } } }]));
  paths[url] ||= {};
  paths[url][method] = { summary, description: `${description} ${isPublic ? 'Public endpoint.' : vendor ? 'Milkman only. Tenant context is derived from the authenticated user; tenant IDs are never accepted in the payload.' : 'Authenticated milkman or customer. Tenant ownership is mandatory and customer accounts are additionally restricted to their own customer_id.'}`.trim(), operationId: method + url.replace(/[^a-zA-Z0-9]/g, '_'), security: isPublic ? [] : [{ bearerAuth: [] }], ...(parametersAll.length ? { parameters: parametersAll } : {}), ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } } : {}), responses: { ...errors, [status]: { description: 'Success', headers: { 'X-Request-Id': { schema: str, description: 'Server-generated correlation ID (also returned on errors).' } }, content: { [result ? 'application/json' : 'text/csv']: { schema: response } } } } };
}
endpoint('/health', 'get', 'Dependency readiness', { public: true, result: 'Health' });
endpoint('/auth/register', 'post', 'Issue milkman registration OTP', { public: true, body: 'Register', result: 'RegistrationResult', status: 202 });
endpoint('/auth/verify', 'post', 'Consume OTP and create vendor account or customer onboarding capability', { public: true, body: 'Verify', result: 'VerificationResult', status: 201 });
endpoint('/auth/login', 'post', 'Sign in', { public: true, body: 'Login', result: 'Session' });
endpoint('/auth/me', 'get', 'Read current account identity', { result: 'Identity' });
endpoint('/auth/dairy/resolve', 'post', 'Resolve dairy code without disclosing customer data', { public: true, body: 'DairyCode', result: 'DairyIdentity' });
endpoint('/auth/customer/register', 'post', 'Issue customer email verification OTP', { public: true, body: 'CustomerRegistration', result: 'RegistrationResult', status: 202 });
endpoint('/auth/customer/complete', 'post', 'Complete verified customer onboarding', { public: true, body: 'CustomerComplete', result: 'Session', status: 201, description: 'Requires a single-use, unexpired onboardingToken returned by OTP verification. Claim only same-tenant unlinked history with matching verified email, or create an inactive profile. A rotated dairy code invalidates pending onboarding.' });
endpoint('/auth/logout', 'post', 'Revoke all current sessions for this account', { result: 'LogoutResult', description: 'Increments the persisted session version. Existing JWTs stop working immediately.' });
endpoint('/profile', 'get', 'Read own role-specific profile', { result: 'Profile' });
endpoint('/profile', 'patch', 'Edit customer name, address and preferred language', { body: 'CustomerSelfUpdate', result: 'Customer', description: 'Customer role only. Rates, email, phone, balances, lifecycle and ownership cannot be changed. Appends an audit record transactionally.' });
endpoint('/profile/code', 'post', 'Replace dairy linking code', { vendor: true, result: 'DairyCode', description: 'Old code stops accepting new connections. Existing linked users retain access. Change is audited.' });
endpoint('/dashboard', 'get', 'Dairy dashboard', { result: 'Dashboard' });
endpoint('/customers', 'get', 'Search customer directory', { vendor: true, result: 'Customer', list: true, parameters: [...page, { name: 'q', in: 'query', schema: str }] });
endpoint('/customers', 'post', 'Add customer', { vendor: true, body: 'CustomerCreate', result: 'Customer', status: 201 });
endpoint('/customers/{id}', 'put', 'Edit customer rates, defaults, service dates and details', { vendor: true, body: 'CustomerUpdate', result: 'Customer', parameters: [{ name: 'id', in: 'path', required: true, schema: id }], description: 'Preserves delivery and bill snapshots. Linked verified emails are immutable. Email normalized to lowercase. Changes and related linked-user name updates are transactional and audited.' });
endpoint('/customers/{id}/status', 'patch', 'Change customer service status', { vendor: true, body: 'StatusChange', result: 'Customer', parameters: [{ name: 'id', in: 'path', required: true, schema: id }] });
endpoint('/records', 'get', 'Read delivery history', { result: 'Delivery', list: true, parameters: [...page, { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }] });
endpoint('/records/batch', 'post', 'Create delivery batch atomically', { vendor: true, idempotent: true, body: 'DeliveryBatch', result: 'Delivery', list: true, status: 201, description: 'All items succeed or all roll back. Service eligibility and closed-period checks are enforced. Rates and totals are calculated by the server.' });
endpoint('/bills', 'get', 'Read monthly bills', { result: 'Bill', list: true, parameters: page });
endpoint('/bills', 'post', 'Finalize completed month', { vendor: true, idempotent: true, body: 'BillCreate', result: 'Bill', status: 201, description: 'Chronological finalization only. Previous bills must be settled in this milestone. Existing customer/month bill is returned unchanged.' });
endpoint('/payments', 'get', 'Read payment history', { result: 'Payment', list: true, parameters: page });
endpoint('/payments', 'post', 'Record money already received', { vendor: true, idempotent: true, body: 'PaymentCreate', result: 'Payment', status: 201, description: 'Does not charge a provider. Amount cannot exceed bill debt. Receipt identifiers and references are unique.' });
endpoint('/reports/deliveries.csv', 'get', 'Export monthly delivery ledger', { parameters: [{ name: 'month', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }], description: 'Bounded to 5,000 rows. CSV formula-leading cells are escaped. Includes business, period, generation timestamp, INR currency and total paise.' });
for (const [path, permission, result, list] of [
  ['/admin/dashboard', 'dashboard.read', 'AdminDashboard', false],
  ['/admin/users', 'users.read', 'AdminUser', true],
  ['/admin/dairies', 'dairies.read', 'AdminDairy', true],
  ['/admin/activity', 'audit.read', 'AdminActivity', true]
]) {
  endpoint(path, 'get', 'Admin ' + path.split('/').pop(), { result, list, parameters: list ? [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } }] : [] });
  paths[path].get.description = 'Admin only. Requires named permission ' + permission + '. Permissions derive from the current database role; disabled accounts and other roles are rejected. Lists use fixed 25-row pagination.';
}
const document = { openapi: '3.1.0', info: { title: 'GauAmrut dairy management API', version: '0.1.0', description: 'Vendor core and customer onboarding. Paths intentionally derive tenant context from the session instead of including tenant IDs as in the SRS route sketch. Refer to ROADMAP.md for unimplemented route families.' }, servers: [{ url: 'http://127.0.0.1:4000/api', description: 'Local development' }], components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas }, paths };
fs.writeFileSync(path.join(__dirname, '../docs/openapi.json'), JSON.stringify(document, null, 2) + '\n');
console.log('Generated docs/openapi.json');
