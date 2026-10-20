# GauAmrut

A full-stack dairy delivery and billing application, developed from [GAUAMRUT_SRS.docx](GAUAMRUT_SRS.docx). The vendor core and first customer-onboarding increment are implemented. This is not the complete production release described in the SRS.

## Run locally on Windows

Prerequisites: Node.js 24, npm, and `mongod` on PATH. MongoDB must run as a replica set for transactions.

```powershell
npm.cmd ci
npm.cmd run setup
node scripts/setup-local.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-mongo.ps1
```

Start the backend in one terminal:

```powershell
cd D:\Projects\GauAmrut\backend
npm start
```

Start the frontend in a second terminal:

```powershell
cd D:\Projects\GauAmrut\frontend
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd start` and `npm.cmd run dev` instead; these run the same scripts without changing your execution policy.

Open **http://127.0.0.1:5173**. API readiness: **http://127.0.0.1:4000/api/health**.

Each terminal controls only its own server; use Ctrl+C to stop it. Vite stays on port 5173, matching the API's allowed local origins. The frontend connects to the API on port 4000 via `frontend/.env`.

The root directory also forwards `npm start` to the backend and `npm run dev` to the frontend. For an optional combined session, use `npm run dev:all` from the root after stopping separately running servers. Only `dev:all` launches both servers and checks both ports.

The MongoDB helper starts a separate, loopback-only replica set on **27018**, with files in `.local/mongodb/`. It does not change the standalone MongoDB instance on 27017. MongoDB continues running after the web/API dev command stops. To stop the project database gracefully, connect to port 27018 and issue `db.adminCommand({ shutdown: 1 })`; a connection-closed response is expected.

`setup-local.cjs` creates ignored environment files and a random JWT signing secret, preserving existing files. Development uses an in-memory login rate limiter when Redis is absent. Production requires Redis and SMTP and disallows development OTP visibility.

Choose **Explore the demo** for a read-only sample workspace, or **Create an account** for a real local account. Registration always emails the verification code to the address you entered; fill `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `backend/.env` (Gmail works via an App Password). Setting `NODE_ENV=development` and `DEV_SHOW_OTP=true` is a test-only escape hatch that returns the code in the API response instead — leave it `false`.

Optional sample data for the real database:

```powershell
$env:SEED_PASSWORD = 'choose-your-own-local-password'
npm.cmd --prefix backend run seed
Remove-Item Env:SEED_PASSWORD
```

Sign in as `owner@gauamrut.local` with the password you chose. Seeding preserves an existing sample account and never runs automatically. The separate read-only demo does not need seeding.

## Implemented

- Responsive React dashboard, customer directory, inline delivery entry, bills/payments, delivery CSV exports, and read-only dairy profile.
- Milkman and customer registration using expiring, hashed, attempt-limited email OTPs; transactional linking; bcrypt passwords; JWT authentication, active-user/linkage checks and server-side logout revocation.
- Customer onboarding by dairy code, explicit verified-email history claiming, and a customer portal with history, bills/payments, CSV export and profile editing.
- Audited vendor editing of customer details, rates, all four defaults, service dates and lifecycle; dairy-code regeneration.
- Tenant-derived customer management with search, pagination, activation/deactivation, service dates, rates, and quantity defaults.
- Transactional delivery batches, exact integer money calculations, historical rate snapshots, unique logical deliveries, and durable request idempotency.
- Daily entry prefills each customer's saved morning/evening quantities and puts milk-type selection inside that customer's row. Both types appear when both have defaults. Edit only that day's exceptions, then select Save deliveries; this never changes the customer's regular defaults. Untouched zero defaults are skipped, and already recorded or queued entries are excluded.
- Completed-month bill generation and transactional payment allocation, unique receipts/provider references, rejection of overpayment, and ledger-write audit records.
- IndexedDB delivery queue with visible queued/syncing/conflicted states and automatic reconnect retries. Static service worker and manifest foundation.
- Development MongoDB helper, environment templates, tests, CI configuration, OpenAPI contract, Vercel rewrite, and Render deployment template.

## Important scope boundaries

- Both milkman and customer accounts have dedicated navigation. The customer portal currently supports reading records/bills/payments, exporting delivery CSV, and editing name/address/language. Customer payment claims, adjustments, products/orders and disputes remain pending. The admin console currently provides permission-scoped read-only dashboard, user/dairy directories and activity log. Admin account management, financial actions and settings are pending.
- Billing uses INR paise and integer millilitres; line charges round half-up to the nearest paise. Bills finalize only after month-end. Prior unbilled deliveries must be billed first. A previous outstanding bill must be settled before a new month is finalized; carry-forward allocations, credits, reversals, tax invoicing, and corrections are deferred.
- Delivery entry is create-only in this milestone. Finalized periods are locked. There is no correction, deletion, or vacation/extra workflow yet.
- Offline writes work after opening a route while connected. Customer/record server-state caching, offline cold-start login, browser-history navigation blocking, queue editing, and cross-device conflict resolution are not complete. Keep the app open for offline route work; reauthenticate after a reload. JWTs are held in memory, not persistent browser storage.
- CSV export is bounded to 5,000 rows. PDF, queued exports, full accounting reports, products/orders, disputes, notifications, WhatsApp, multilingual UI, subscriptions, backups, monitoring, and production operational verification remain future work.
- Lists paginate. The bill-generation customer picker currently shows the first 100 customers; customer and daily-entry pages paginate in batches of 50. Daily recorded-delivery history shows at most 100 rows.

See [the verification report](docs/VERIFICATION.md) and [the implementation roadmap](docs/ROADMAP.md) for release gaps and product decisions. The original SRS remains unchanged; `docs/SRS.txt` is an extracted reading copy.

## Customer connection

A dairy owner shares the code from **Dairy profile**. A customer chooses **I’m a customer — join my dairy**, confirms the business, and verifies their email. Matching unlinked history is offered only after verification; selecting it preserves rates, deliveries and bills. To enable this, the dairy must first add that email to the existing customer profile. Phone numbers alone never authorize a claim.

If the customer creates a new profile, it starts **inactive** with zero rates/defaults. The dairy can use **Customers → Edit customer** to configure rates/defaults and activate service. Linked email addresses cannot be changed by the dairy. Code regeneration blocks new and pending connections using the old code, while existing linked accounts retain access.

## Validation

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd --prefix backend audit
npm.cmd --prefix frontend audit
npm.cmd run test:e2e
```

Backend tests launch an isolated ephemeral MongoDB replica set. They use the installed `mongod` when available, otherwise mongodb-memory-server downloads one. No tests erase the development database. To explicitly choose a binary, set `MONGOMS_SYSTEM_BINARY`; `MONGOMS_VERSION` defaults to `8.0.28`.

Browser tests use Microsoft Edge on Windows, a separate test API on port 4001, frontend on 5174, and an ephemeral test database. They cover desktop/mobile rendering, the vendor registration-to-payment journey with offline sync, and customer history claiming and profile editing. For another environment, install Playwright Chromium (`npx.cmd playwright install chromium`) and set `PLAYWRIGHT_CHANNEL=chromium`. Screenshots are written to the ignored `test-results/` directory.

The API contract is [docs/openapi.json](docs/openapi.json), generated with `node scripts/generate-openapi.cjs`.

## Structure and deployment

`frontend/` contains the static React application. `backend/src/` separates validation, authentication, middleware, domain rules, transactional services, and Mongoose repositories/models. `scripts/` contains local setup tools. `docs/` contains the API contract and implementation status.

Vercel: root `frontend`, install `npm ci`, build `npm run build`, output `dist`; set `VITE_API_URL` to the Render HTTPS API URL ending in `/api`. Render: use `render.yaml`, supply MongoDB Atlas replica-set URI, Redis, SMTP, and exact frontend origins. Deployments have not been created or published. CI/branch protection and production environment configuration still require repository/platform setup.

Security audit findings required newer Vite, React Router, Vitest, and Nodemailer versions than the SRS baseline. React 18, Express 4/CommonJS, Mongoose, Redux Toolkit, Axios, and Tailwind remain. Installed versions are reproducible through the three lockfiles. Secrets belong only in ignored local `.env` files or hosting environment stores.

## Local admin access

Open http://127.0.0.1:5173/admin and sign in with the local admin account. Admin login uses the same authentication service, then opens the admin console. Public registration never accepts admin roles.

The local bootstrap credentials are stored only in the ignored backend/.env file as ADMIN_EMAIL and ADMIN_PASSWORD. From backend, run npm run bootstrap:admin to create the account in the configured development database. The command is repeatable when credentials match, and never overwrites an existing conflicting account. Passwords are hashed in MongoDB. It does not run automatically on server startup.

The first console is read-only: Overview, Users, Dairies, and Activity log. Permissions are derived from the stored admin role and rechecked on each request. User lifecycle changes, role assignment, financial operations, backups and settings remain future SRS work.
