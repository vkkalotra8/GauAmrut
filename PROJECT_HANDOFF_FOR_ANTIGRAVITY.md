# PROJECT HANDOFF & COMPLETE CODEBASE ARCHITECTURE AUDIT
**Document Type:** AI-to-AI Technical Architecture Handoff  
**Target Agent:** Google Antigravity  
**Audited Repository:** GauAmrut (`d:\Projects\GauAmrut`)  
**Audit Date:** 2026-09-14  
**Audit Mode:** Complete Read-Only Codebase Inspection  
**Constraint Adherence:** Zero modification to existing application code, configs, or tests.

---

## 1. PRIMARY OBJECTIVE & EXECUTIVE TECHNICAL OVERVIEW

This document is an exhaustive, ground-truth technical audit of the **GauAmrut** codebase, produced specifically for an incoming AI coding agent (Antigravity). It details the current state, architecture, exact data flows, data structures, coding patterns, security posture, and roadmap boundaries of the project as it exists on disk.

### What is GauAmrut?
GauAmrut is a full-stack SaaS platform designed for local dairy owners (milkmen) and their retail milk customers in India. It manages:
1. **Daily milk delivery logistics:** Fast recording of morning and evening deliveries for cow and buffalo milk with route ordering, saved customer quantity defaults, and offline-first device queuing.
2. **Strict integer financial ledger:** Monthly billing and payment recording calculated with exact integer arithmetic (INR paise and millilitres), chronological billing order, payment allocation, and durable request idempotency.
3. **Multi-tenant and multi-role operations:** Role-based experiences for Dairy Owners (`milkman`), verified Retail Customers (`customer`), and Platform Administrators (`admin`).
4. **Verified customer onboarding & history linking:** Dairy-code-based customer sign-up with email OTP verification and cryptographic history claiming allowing unlinked paper/offline customer profiles to be connected to newly registered customer user accounts without data loss.

---

## 2. AUDIT INTEGRITY & OPERATIONAL RULES

* **Fact vs. Inference Standard:** Every assertion in this document is labeled as **CONFIRMED FROM CODE** (verified in source), **INFERRED** (derived logically from configs/specs), or **UNKNOWN / NOT FOUND** (absent from the repository).
* **Source of Truth:** The running code in `backend/src/` and `frontend/src/` is the absolute ground truth. Where documentation (`docs/ROADMAP.md`, `README.md`, `docs/SRS.txt`) differs from code, the active code behavior is documented and discrepancies are flagged.
* **Preservation Rule:** Antigravity must preserve all architectural layers, integer calculations, transactional boundaries, and UI design styles.

---

## 3. REPOSITORY STRUCTURE

**CONFIRMED FROM CODE:** The project is organized as a lightweight monorepo with separate root, backend, frontend, scripts, e2e, and documentation directories:

```text
d:\Projects\GauAmrut\
├── .github/
│   └── workflows/
│       └── ci.yml                     # GitHub Actions CI pipeline (Node 24, Playwright Chromium, audits)
├── .gitignore                         # Git ignore definitions (node_modules, dist, .env, .local, test-results)
├── GAUAMRUT_SRS.docx                  # Original Software Requirements Specification (Word format)
├── README.md                          # Main developer onboarding, Windows local setup, running guide
├── package.json                       # Root script orchestrator (concurrently, playwright, engines: Node >=22 <25)
├── package-lock.json                  # Root dependency lockfile
├── playwright.config.cjs              # Playwright E2E configuration (ports 4001 test API, 5174 frontend)
├── render.yaml                        # Production deployment descriptor for Render (Node web service)
├── backend/
│   ├── .env                           # Local environment file (ignored by Git)
│   ├── .env.example                   # Environment variable template
│   ├── eslint.config.js               # Flat ESLint 9 configuration for backend
│   ├── package.json                   # Backend dependencies and scripts (Express, Mongoose, Redis, Jest)
│   ├── package-lock.json              # Backend dependency lockfile
│   ├── src/
│   │   ├── accounts.js                # Customer and dairy profile management, code regeneration, audit transactions
│   │   ├── admin-permissions.js       # Admin role to permission list mapping
│   │   ├── admin.js                   # Admin dashboard metrics and paginated directories (users, dairies, activity)
│   │   ├── app.js                     # Express application factory, middleware pipeline, routes, error handler
│   │   ├── auth.js                    # Authentication routes (register, OTP verify, login, logout, identity)
│   │   ├── bootstrap-admin.js         # CLI script to bootstrap local super-admin account
│   │   ├── domain.js                  # Domain math (BigInt charge calculation), today() in Asia/Kolkata, csvCell
│   │   ├── middleware.js              # Express middlewares (async wrap, Joi validate, auth JWT, vendor check, scope)
│   │   ├── models.js                  # 10 Mongoose models with strict schemas, validation, and compound indexes
│   │   ├── onboarding.js              # Dairy resolution, customer onboarding tokens, and historical account claiming
│   │   ├── seed.js                    # Development database seeding script (owner@gauamrut.local)
│   │   ├── server.js                  # Server startup, MongoDB replica set verification, Redis connection, shutdown
│   │   ├── services.js                # Idempotent transactional ledger operations (enterDeliveries, generateBill, recordPayment)
│   │   └── validation.js              # Joi validation schemas for all incoming API payloads
│   └── test/
│       ├── api.test.js                # 38 integration tests against isolated MongoDB memory replica set
│       └── domain.test.js             # Unit tests for domain math, BigInt rounding, and CSV sanitization
├── frontend/
│   ├── .env                           # Frontend environment file (ignored by Git)
│   ├── .env.example                   # Frontend environment template (VITE_API_URL)
│   ├── eslint.config.js               # Flat ESLint 9 config for React
│   ├── index.html                     # HTML entry point (DM Sans & Manrope Google Fonts, root div)
│   ├── package.json                   # Frontend dependencies (React 18, Redux Toolkit, Tailwind, Lucide, Vitest)
│   ├── package-lock.json              # Frontend dependency lockfile
│   ├── postcss.config.js              # PostCSS config (TailwindCSS, Autoprefixer)
│   ├── tailwind.config.js             # Tailwind CSS configuration
│   ├── vercel.json                    # Single-page application route rewrite configuration
│   ├── vite.config.js                 # Vite 8 config with React plugin and Vitest jsdom setup
│   ├── public/
│   │   ├── icon.svg                   # GauAmrut droplet brand icon
│   │   ├── manifest.webmanifest       # PWA web app manifest
│   │   └── sw.js                      # Static app shell service worker
│   └── src/
│       ├── App.jsx                    # Root UI router, navigation shell, vendor dashboard, billing, reports
│       ├── App.test.jsx               # App routing and shell component tests
│       ├── demo.js                    # In-memory sample data for read-only demo mode
│       ├── lib.js                     # Axios API instance with interceptors, Redux store/slice, currency/date utilities
│       ├── main.jsx                   # React DOM entry point, Redux Provider, BrowserRouter, SW registration
│       ├── offline.js                 # IndexedDB delivery queue, syncQueue worker, retry and conflict detection
│       ├── styles.css                 # 24KB consolidated styling system, responsive breakpoints, design tokens
│       ├── test-setup.js              # Vitest Jest-DOM matchers setup
│       ├── components/
│       │   └── ui.jsx                 # Reusable UI primitives: Brand, Notice, State, Empty, Heading, Modal, Field
│       ├── features/
│       │   ├── admin/
│       │   │   └── AdminPortal.jsx    # Permission-scoped admin dashboard, user/dairy tables, activity log
│       │   ├── auth/
│       │   │   └── Auth.jsx           # Multi-mode auth view (login, vendor register, dairy resolve, customer onboard, OTP)
│       │   ├── customer/
│       │   │   └── Portal.jsx         # Customer portal: CustomerHome, CustomerHistory, CustomerPayments, CustomerProfile
│       │   └── vendor/
│       │       ├── CustomerEditor.jsx # Modal editor for customer details, rates, 4 quantity defaults, service dates
│       │       ├── DairyProfile.jsx   # Dairy identity view, code display, code regeneration modal
│       │       ├── Records.jsx        # Route-based daily delivery entry table, offline queue status, recorded history
│       │       └── Records.test.jsx   # Unit tests for delivery helpers and calculations
│       └── hooks/
│           └── useData.js             # Custom data fetching hook with demo fallback, auto-reload, and AbortController
├── docs/
│   ├── openapi.json                   # OpenAPI 3.1.0 complete API specification
│   ├── ROADMAP.md                     # Detailed delivery milestones, implemented features vs deferred scope
│   ├── SRS.txt                        # Extracted plain-text copy of the original SRS
│   └── VERIFICATION.md                # Test execution report and verified security/architectural findings
└── scripts/
    ├── check-dev-ports.cjs            # Port probe checking ports 4000 and 5173 before running dev:all
    ├── e2e-api.cjs                    # Ephemeral test backend runner for Playwright on port 4001
    ├── generate-openapi.cjs           # Script generating docs/openapi.json
    ├── init-mongo.cjs                 # Replica set initiator for local development MongoDB
    ├── setup-local.cjs                # Automated creation of backend/.env and frontend/.env with random JWT secret
    └── start-mongo.ps1                # PowerShell script launching mongod on port 27018 with replica set
```

---

## 4. TECHNOLOGY STACK

**CONFIRMED FROM CODE:**

### Frontend
* **Core Framework:** React 18.3.1 (functional components and hooks)
* **Build Tool & Dev Server:** Vite 8.3.0
* **Routing:** `react-router-dom` 7.18.3 (`BrowserRouter`, `Routes`, `Route`, `NavLink`, `Navigate`)
* **State Management:** `@reduxjs/toolkit` 2.9.0 (`session` slice) + `react-redux` 9.2.0
* **Offline Storage:** `idb` 8.0.3 (IndexedDB wrapper database `gauamrut-deliveries`, object store `queue`)
* **Styling & CSS:** Tailwind CSS 3.4.17 + PostCSS 8.5.6 + Autoprefixer 10.4.21 + custom CSS design tokens in `styles.css`
* **Typography:** Google Fonts (`DM Sans` for body/data, `Manrope` for headings/brand)
* **Icons:** `lucide-react` 0.468.0
* **HTTP Client:** `axios` 1.12.2 (with request auth interceptor and 401 response interceptor)
* **Test Runners:** `vitest` 5.0.0, `@testing-library/react` 16.3.0, `@testing-library/jest-dom` 6.8.0, `jsdom` 26.1.0

### Backend
* **Runtime:** Node.js (engines: `>=22 <25`, CI tests on Node 24.x)
* **Module System:** CommonJS (`require` / `module.exports`)
* **Web Framework:** Express 4.22.2 (`createApp` factory in `src/app.js`)
* **Security Middleware:** `helmet` 8.1.0, `cors` 2.8.5 (dynamic origin validator with `CORS_ORIGINS`)
* **Rate Limiting:** `express-rate-limit` 8.1.0 + `rate-limit-redis` 4.2.2 (with in-memory fallback)
* **Validation:** `joi` 17.13.3 (strict schema definitions with custom date and regex validators)
* **Authentication:** `jsonwebtoken` 9.0.2 (HS256, 8-hour expiration), `bcryptjs` 3.0.2 (salt work factor 12)
* **Email Delivery:** `nodemailer` 10.0.3 (SMTP with TLS support)
* **Test Runners:** `jest` 30.2.0, `supertest` 7.1.4, `mongodb-memory-server` 10.2.0 (ephemeral replica sets)

### Database
* **Database Engine:** MongoDB (mandatory **replica set** required for multi-document ACID transactions)
* **Driver / ODM:** `mongoose` 8.19.0
* **Cache / Distributed Store:** `redis` 5.8.0 (optional in local dev, mandatory in production)
* **Schema Enforcement:** Mongoose schemas defined with `timestamps: true` and `strict: 'throw'`

### Infrastructure & Deployment
* **Local Windows Helper:** PowerShell `scripts/start-mongo.ps1` starting `mongod` on `127.0.0.1:27018` with replica set `gauamrut-rs`
* **PaaS Configuration:** `render.yaml` for Render Web Service (backend Node runtime)
* **Static Host Rewrites:** `frontend/vercel.json` rewrite routing all non-asset requests to `index.html`
* **CI/CD:** `.github/workflows/ci.yml` (automated lint, unit test, build, audit, and Playwright e2e test on push/PR)

---

## 5. FRONTEND DEEP ANALYSIS

### Application Bootstrap & Entry
**CONFIRMED FROM CODE (`frontend/src/main.jsx`):**
1. Mounts React into `<div id="root"></div>` with `React.StrictMode`.
2. Wraps the app with Redux `<Provider store={store}>` and `<BrowserRouter>`.
3. In production (`import.meta.env.PROD`), registers the service worker `/sw.js` on window load.

### Global State (`frontend/src/lib.js`)
A single Redux slice named `session` manages authentication and preview state:
```javascript
initialState: { token: null, user: null, demo: false }
```
* **Actions:**
  * `signIn({ token, user })`: Sets JWT token and user profile, resets `demo: false`.
  * `preview()`: Launches the read-only demo mode with mock user `'Aarav Patel'`, `demo: true`, and `token: null`.
  * `signOut()`: Clears token, user, and demo flag.
  * `updateUser(payload)`: Mutates user profile properties (e.g. name, code) in state.
* **CRITICAL SECURITY NOTE:** The JWT token is held **strictly in memory** inside the Redux store. It is never persisted to `localStorage` or `sessionStorage`. Reloading the page clears the token and requires re-authentication.

### API Client & Interceptors (`frontend/src/lib.js`)
* Axios instance created with `baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api'`.
* **Request Interceptor:** Reads `store.getState().session.token`. If present, attaches `Authorization: Bearer <token>`.
* **Response Interceptor:** If an API call returns HTTP `401` and a token was active, it immediately dispatches `store.dispatch(signOut())`.

### Custom Hook: `useData(path, example = null)` (`frontend/src/hooks/useData.js`)
* Universal declarative data fetcher.
* If `demo` mode is active, it returns `{ data: example, loading: false, error: '', meta: null }` without making network calls.
* In real mode, uses an `AbortController` to cancel pending requests when parameters or paths change.
* Subscribes to `delivery-synced` DOM events: when background offline sync completes, it triggers an automatic data reload.
* Exposes `reload()` to manually re-fetch data.

### Offline-First IndexedDB Sync Queue (`frontend/src/offline.js`)
* Uses `idb` to open `gauamrut-deliveries` (version 1) with object store `queue` keyed by `key` (UUID).
* **`enqueue(owner, body, key)`:** Adds a delivery batch `{ owner, body, key, status: 'queued', createdAt }`.
* **`syncQueue(owner, onChange)`:**
  * Guards against concurrent runs (`let running = false`).
  * Iterates queued items. Updates status to `'syncing'`.
  * Sends POST to `/records/batch` with header `Idempotency-Key: item.key`.
  * On success: deletes item from IndexedDB and fires `window.dispatchEvent(new Event('delivery-synced'))`.
  * On failure: if HTTP error is 4xx (except 401 auth or 429 rate limit), marks status as `'conflicted'` and stores server error message. If network failure or 5xx, remains `'queued'`.
* **`discard(key)`:** Allows user to remove a conflicted batch.

### Routing & View Architecture (`frontend/src/App.jsx`)
App inspects `session.user`:
1. **Unauthenticated (`!session.user`):** Renders `<Auth/>`.
2. **Platform Admin (`session.user.role === 'admin'`):** Renders `<AdminPortal/>`.
3. **Dairy Owner / Milkman (`role === 'milkman'`):**
   * `/` ➔ `<Dashboard/>` (overview stats, daily volume bar chart, recent deliveries table, quick actions)
   * `/customers` ➔ `<Customers/>` (searchable, paginated customer directory, status toggle, modal customer editor)
   * `/records` ➔ `<Records/>` (route-based daily delivery entry, morning/evening shifts, unsaved navigation warning, recorded history)
   * `/payments` ➔ `<Payments/>` (monthly bill finalization modal, payment recording modal, receipt generation)
   * `/reports` ➔ `<Reports/>` (CSV delivery export by month)
   * `/profile` ➔ `<Profile/>` (dairy business details, code display and regeneration modal)
4. **Customer (`role === 'customer'`):**
   * `/` ➔ `<CustomerHome/>` (account summary, today's milk, unpaid bills, quick links)
   * `/customers` ➔ Redirects to `/` (customer accounts cannot view customer directories)
   * `/records` ➔ `<CustomerHistory/>` (paginated delivery history with historical rate/total snapshots)
   * `/payments` ➔ `<CustomerPayments/>` (finalized bills and recorded payment history)
   * `/reports` ➔ `<Reports/>` (customer's own delivery records CSV export)
   * `/profile` ➔ `<CustomerProfile/>` (self-service name, delivery address, and language preference editor)

---

## 6. FRONTEND DESIGN SYSTEM & VISUAL LANGUAGE

**CONFIRMED FROM CODE (`frontend/src/styles.css`):**
The design system is a carefully crafted aesthetic built with warm natural earth tones, farm-fresh dairy motifs, clean borders, and strict typography.

### Color Tokens & Palette
* **Primary Brand Green:** `--green: #176348` (hover: `#104e37`, subtle container: `#e9f1e7`)
* **Background Surface:** `#f7f9f6` (creamy off-white/light sage)
* **Text / Ink Color:** `#263d35` (deep forest green-black)
* **Muted Text:** `--muted: #748178` and `#839079`
* **Border Color:** `--border: #e6ebe5` and `#dfe5da`
* **Accent / Focus:** `#d99537` (warm gold / amber focus ring: `outline: 3px solid #d99537; outline-offset: 3px`)
* **Card Surface:** `#ffffff`
* **Status Badges:**
  * Active / Recorded / Success: background `#edf5e9`, text `#62844d`, border `#e0edda`
  * Inactive / Neutral: background `#f0f1ee`, text `#757f70`, border `#e7eae2`
  * Error / Notice Alert: background `#fff2ed`, text `#a94d34`, border `#f4d9cf`
  * Notice Info: background `#eef4e9`, text `#476b3f`, border `#dbe7d2`
* **Stat Card Accents:** Green (`#edf4e9` / `#5d8753`), Blue (`#edf3f7` / `#6b93a1`), Gold (`#f8f3e4` / `#b59a49`), Orange (`#fbefe7` / `#c39167`)

### Typography
* **Primary Sans:** `'DM Sans', sans-serif` (body text, inputs, data cells, badges)
* **Display / Brand:** `'Manrope', sans-serif` (h1, h2, h3, brand titles, stat numbers)
* **Scale:**
  * Base: `14px`
  * H1: `29px`, line-height `1.3`, letter-spacing `-1px`, weight `750`
  * H2: `17px`, weight `750`, letter-spacing `-.4px`
  * H3: `16px`, weight `700`
  * Small: `12px` or `10px` for labels and secondary metadata
  * Eyebrow: `9px` or `8px`, uppercase, letter-spacing `1.7px`, weight `700`

### Components & UI Primitives (`frontend/src/components/ui.jsx`)
* **`<Brand/>`:** Displays droplet icon in rounded badge with `GauAmrut` logotype and subtitle `"PURE MILK. SIMPLE BUSINESS."`.
* **`<Notice error={boolean}/>`:** Status or error banner with accessible `role="alert"` / `role="status"`.
* **`<State resource={...}>`:** Handles loading spinner (`"Loading your dairy…"`), error state with `"Try again"` button, and renders children when data is ready.
* **`<Empty>`:** Centered empty state container with droplet icon and message.
* **`<Heading>`:** Section title with eyebrow, title, description, and action button slots.
* **`<Modal title close>`:** Native `<dialog id="app-dialog">` wrapper with backdrop blur (`#15372d75`), focus restoration, and close button.
* **`<Field label ...props>`:** Accessible input label pairing.

### Responsive Breakpoints
* **`> 1500px`:** Generous padding (`32px 50px`), larger stat numbers (`32px`), taller banners.
* **`< 1200px`:** Sidebar narrows to `215px`, stats grid compresses, customer grid drops to 2 columns.
* **`< 950px`:** Stats grid drops to 2 columns, quick-action card hides, layout stacks vertically.
* **`< 720px` (Mobile):**
  * Sidebar transitions off-screen (`transform: translateX(-100%)`) with mobile slide-over and backdrop overlay (`.sidebar-overlay`).
  * Topbar becomes sticky with hamburger menu button (`.mobile-menu`).
  * Auth story panel hides illustrations, keeping form centered.
  * Form grids collapse from 2 columns to 1 column.
  * Save bar in delivery entry pins to bottom with stacked layout.

---

## 7. BACKEND DEEP ANALYSIS

### Server Lifecycle & Readiness (`backend/src/server.js`)
1. Reads environment configuration via `dotenv`.
2. Verifies mandatory environment variables: `MONGO_URI`, `JWT_SECRET` (length >= 32, not default template), and `CORS_ORIGINS`.
3. In `production`, mandates `REDIS_URL`, `SMTP_HOST`, and asserts `DEV_SHOW_OTP !== 'true'`.
4. Connects to MongoDB via Mongoose. Runs admin command `{ hello: 1 }` and asserts `hello.setName` is defined. **Fails startup immediately if MongoDB is not running as a replica set.**
5. Calls `init()` on all 10 Mongoose models to guarantee compound and unique indexes are built before taking traffic.
6. Connects to Redis if `REDIS_URL` is set.
7. Binds Express server to `0.0.0.0:${PORT || 4000}`.
8. Registers graceful shutdown hooks on `SIGINT` and `SIGTERM` (closes server, disconnects Mongo and Redis, 15-second unref timeout).

### Middleware Pipeline (`backend/src/app.js` & `backend/src/middleware.js`)
Requests pass through:
1. `req.requestId = crypto.randomUUID()` attached to request and returned in `X-Request-Id` response header.
2. `helmet()` security headers.
3. `cors()` with origin validation checking `process.env.CORS_ORIGINS`. Exposes `X-Request-Id`.
4. `express.json({ limit: '100kb' })`.
5. Public `/api/health` endpoint: returns HTTP 200/503 checking Mongoose `readyState === 1` and Redis status.
6. `/api/auth` router with rate limiter (20 requests / 15 mins).
7. `/api` protected sub-router:
   * **`auth` middleware:** Extracts Bearer token. Verifies JWT HS256 signature and issuer `'gauamrut'`. Finds active user in DB. Compares `token.sv` with `user.sessionVersion` (server-side session revocation). If user is customer, validates that `customer_id` is linked to `user._id` and `milkman_id`. Sets `req.user` and `req.tenant = user.milkman_id`.
   * **`/admin` router:** Routes guarded by role check and permission middleware.
   * **Admin Route Guard:** Blocks users with `role === 'admin'` from calling dairy/customer tenant endpoints.
   * **`accountsRoutes`:** Profile and customer editing.
   * **Tenant endpoints:** Dashboard, customers, delivery records, bills, payments, reports.
8. 404 Handler for unmatched routes.
9. Centralized Error Handler:
   * Translates MongoDB duplicate key errors (`code: 11000`) to HTTP 409 `DUPLICATE_RECORD`.
   * Translates Mongoose validation/cast errors to HTTP 400 `VALIDATION_ERROR`.
   * Standardizes response format: `{ error: { code: '...', message: '...' } }`. Logs 5xx errors with `requestId`.

### Multi-Tenant Isolation Pattern (`backend/src/middleware.js`)
Tenant isolation is enforced strictly on every query using the `scope(req)` helper:
```javascript
const scope = req => ({
  milkman_id: req.tenant,
  ...(req.user.role === 'customer' ? { customer_id: req.user.customer_id } : {})
});
```
* A dairy owner (`role === 'milkman'`) queries all records where `milkman_id == req.tenant`.
* A customer (`role === 'customer'`) queries records where `milkman_id == req.tenant` AND `customer_id == req.user.customer_id`.
* Direct customer ID lookups always verify `milkman_id: req.tenant`.

### Domain Logic & Integer Arithmetic (`backend/src/domain.js`)
* **Strict Currency & Units:** All monetary values are integer **paise** (1 INR = 100 paise). All milk volumes are integer **millilitres** (1 Litre = 1,000 ml).
* **BigInt Half-Up Rounding:** Line charge calculation avoids IEEE-754 floating-point inaccuracies:
  ```javascript
  function charge(quantityMl, ratePaise) {
    if (![quantityMl, ratePaise].every(n => Number.isSafeInteger(n) && n >= 0))
      throw new AppError(400, 'INVALID_AMOUNT', 'Amounts must be non-negative integers.');
    const total = (BigInt(quantityMl) * BigInt(ratePaise) + 500n) / 1000n;
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new AppError(400, 'INVALID_AMOUNT', 'Amount is too large.');
    return Number(total);
  }
  ```
  *(Adding `500n` before dividing by `1000n` implements exact mathematical half-up rounding to the nearest integer paise).*
* **Date Handling:** `today()` formats the current date strictly as `YYYY-MM-DD` in the `Asia/Kolkata` timezone.
* **CSV Injection Prevention:** `csvCell(value)` prepends an apostrophe if a cell string begins with `=, +, @, -` to neutralize spreadsheet macro execution vulnerabilities.

### Idempotency & Transaction Serialization (`backend/src/services.js`)
All mutating financial writes (`enterDeliveries`, `generateBill`, `recordPayment`) are wrapped in `writeOnce(req, operation)`:
1. Mandates header `Idempotency-Key` (8-128 chars matching `/^[\w-]{8,128}$/`).
2. Calculates SHA-256 `fingerprint` of `{ path: req.originalUrl, body: req.body }`.
3. Checks `IdempotencyKey` collection for `(owner_scope, key)`. If found with identical hash, replays cached response. If found with different hash, throws HTTP 409 `IDEMPOTENCY_CONFLICT`.
4. Starts a MongoDB transaction (`session.withTransaction`).
5. Inserts the idempotency record first within the transaction to serialize concurrent retries.
6. Increments `Customer.__v` (`$inc: { __v: 1 }`) to acquire a document-level lock and prevent concurrent race conditions across billing and delivery writes.
7. Executes the ledger operation, stores the final response on the idempotency record, and logs an entry into the `ActivityLog` (`Audit`) collection.

---

## 8. COMPLETE API INVENTORY

**CONFIRMED FROM CODE (`backend/src/app.js`, `auth.js`, `accounts.js`, `admin.js`):**

| Method | Endpoint | Purpose | Auth Required | Request Body / Query | Success Response | Error Codes / Notes |
|---|---|---|---|---|---|---|
| `GET` | `/api/health` | System health & readiness check | None | None | `{ success, data: { status, database, redis } }` | 503 if DB disconnected |
| `POST` | `/api/auth/register` | Register new dairy owner | Rate Limit (20/15m) | `{ name, businessName, phone, email, password }` | HTTP 202 `{ success, data: { message, developmentOtp? } }` | 409 `ACCOUNT_EXISTS`, 503 `EMAIL_UNAVAILABLE` |
| `POST` | `/api/auth/customer/register` | Register new retail customer | Rate Limit (20/15m) | `{ name, phone, email, password, code, address?, language? }` | HTTP 202 `{ success, data: { message, developmentOtp? } }` | 404 `DAIRY_NOT_FOUND`, 409 `ACCOUNT_EXISTS` |
| `POST` | `/api/auth/dairy/resolve` | Verify dairy code before customer sign up | Rate Limit (20/15m) | `{ code }` (8 chars) | `{ success, data: { businessName, code } }` | 404 `DAIRY_NOT_FOUND` |
| `POST` | `/api/auth/verify` | Verify email OTP & create account / onboard | Rate Limit (20/15m) | `{ email, otp }` (6 digits) | HTTP 201 `{ success, data: { token, user } }` OR `{ onboardingRequired: true, onboardingToken, historyCandidates }` | 400 `INVALID_OTP` (max 5 attempts, 10 min TTL) |
| `POST` | `/api/auth/customer/complete` | Complete customer onboarding & link account | Rate Limit (20/15m) | `{ onboardingToken, claimCustomerId? , createNew? }` | HTTP 201 `{ success, data: { token, user } }` | 400 `ONBOARDING_EXPIRED`, 409 `CLAIM_UNAVAILABLE` |
| `POST` | `/api/auth/login` | User login (all roles) | Rate Limit (20/15m) | `{ email, password }` | `{ success, data: { token, user } }` | 401 `INVALID_CREDENTIALS` |
| `GET` | `/api/auth/me` | Current user profile & identity | Bearer JWT | None | `{ success, data: { id, name, email, role, businessName, permissions? } }` | 401 `UNAUTHORIZED` |
| `POST` | `/api/auth/logout` | Revoke user sessions server-side | Bearer JWT | None | `{ success, data: { message } }` | Increments `user.sessionVersion` |
| `GET` | `/api/profile` | Read dairy or customer profile | Bearer JWT | None | `{ success, data: Customer \| Milkman }` | Role-aware (returns Milkman or Customer doc) |
| `PATCH` | `/api/profile` | Customer self-service profile update | Bearer JWT (Customer) | `{ name, address, language }` | `{ success, data }` | 403 `FORBIDDEN` if called by vendor |
| `POST` | `/api/profile/code` | Regenerate dairy connection code | Bearer JWT (Vendor) | None | `{ success, data: { code } }` | Retries on unique collision (up to 5 times) |
| `GET` | `/api/dashboard` | Dashboard metrics, daily & monthly stats | Bearer JWT | None | `{ success, data: { date, today, monthly, outstandingPaise, collectedPaise, recent, businessName } }` | Multi-aggregate query, scoped by role |
| `GET` | `/api/customers` | Search & paginate customer directory | Bearer JWT (Vendor) | Query: `q` (name search), `page`, `limit` (max 100) | `{ success, data: [Customer], meta: { total, page, limit } }` | Sorted by routeMorning, then name |
| `POST` | `/api/customers` | Add new customer to dairy | Bearer JWT (Vendor) | `{ name, email, phone, address, startDate, endDate?, cowRatePaise, buffaloRatePaise, morningCowMl, eveningCowMl, morningBuffaloMl, eveningBuffaloMl, routeMorning, routeEvening }` | HTTP 201 `{ success, data }` | Audited in ActivityLog |
| `PUT` | `/api/customers/:id` | Update customer details, rates & defaults | Bearer JWT (Vendor) | Customer schema + `{ status }` | `{ success, data }` | 409 `VERIFIED_EMAIL_LOCKED` if linked email changed |
| `PATCH` | `/api/customers/:id/status` | Toggle customer status active/inactive | Bearer JWT (Vendor) | `{ status: 'active' \| 'inactive' }` | `{ success, data }` | Audited in ActivityLog |
| `GET` | `/api/records` | Query recorded milk deliveries | Bearer JWT | Query: `date` (YYYY-MM-DD), `page`, `limit` | `{ success, data: [Record], meta }` | Filtered by `scope(req)` and `deleted: false` |
| `POST` | `/api/records/batch` | Record batch of daily deliveries | Bearer JWT (Vendor) + `Idempotency-Key` | `{ items: [{ customer_id, date, shift, type, quantityMl }] }` (max 100 items) | HTTP 201 `{ success, data: [Record] }` | 409 `PERIOD_CLOSED`, 409 `INELIGIBLE_DELIVERY` |
| `GET` | `/api/bills` | List finalized monthly bills | Bearer JWT | Query: `page`, `limit` | `{ success, data: [Bill], meta }` | Sorted by month descending |
| `POST` | `/api/bills` | Finalize monthly bill for customer | Bearer JWT (Vendor) + `Idempotency-Key` | `{ customer_id, month }` (YYYY-MM) | HTTP 201 `{ success, data: Bill }` | 409 `MONTH_OPEN`, 409 `BILL_ORDER`, 409 `UNSETTLED_PREVIOUS_BILL` |
| `GET` | `/api/payments` | List recorded payments | Bearer JWT | Query: `page`, `limit` | `{ success, data: [Payment], meta }` | Sorted by createdAt descending |
| `POST` | `/api/payments` | Record customer payment received | Bearer JWT (Vendor) + `Idempotency-Key` | `{ bill_id, amountPaise, method, reference? }` | HTTP 201 `{ success, data: Payment }` | Generates receipt `GA-<UUID>`. 409 `INVALID_PAYMENT` on overpay |
| `GET` | `/api/reports/deliveries.csv` | Export monthly deliveries as CSV | Bearer JWT | Query: `month` (YYYY-MM) | CSV file download attachment | Bounded to 5,000 rows. Escapes CSV injection |
| `GET` | `/api/admin/dashboard` | Platform metrics for admin | Bearer JWT (`admin`) | None | `{ success, data: { users, dairies, customers, activeUsers, deliveries } }` | Requires `dashboard.read` permission |
| `GET` | `/api/admin/users` | Paginated user directory | Bearer JWT (`admin`) | Query: `page` | `{ success, data: [User], meta }` | Requires `users.read` permission |
| `GET` | `/api/admin/dairies` | Paginated dairy directory | Bearer JWT (`admin`) | Query: `page` | `{ success, data: [Milkman], meta }` | Requires `dairies.read` permission |
| `GET` | `/api/admin/activity` | Paginated platform audit log | Bearer JWT (`admin`) | Query: `page` | `{ success, data: [Audit], meta }` | Requires `audit.read` permission |

---

## 9. DATABASE MODELS & SCHEMA SPECIFICATION

**CONFIRMED FROM CODE (`backend/src/models.js`):**

### 1. Model: `User`
```text
User
 ├── _id: ObjectId (PK)
 ├── email: String (required, unique, normalized lowercase)
 ├── password: String (required, select: false, bcrypt hash)
 ├── role: String (enum: ['milkman', 'customer', 'admin'], required)
 ├── adminRole: String (enum: ['super_admin', 'operations', 'finance', 'support'], optional)
 ├── active: Boolean (default: true)
 ├── milkman_id: ObjectId (ref: Milkman, required if role !== 'admin')
 ├── customer_id: ObjectId (ref: Customer, optional, set when role === 'customer')
 ├── name: String
 ├── sessionVersion: Number (default: 0, select: false)
 ├── createdAt: Date
 └── updatedAt: Date
```

### 2. Model: `Milkman`
```text
Milkman
 ├── _id: ObjectId (PK, shared with User.milkman_id)
 ├── user_id: ObjectId (ref: User, required, unique index)
 ├── businessName: String
 ├── name: String
 ├── phone: String
 ├── upiId: String
 ├── code: String (unique, 8-char uppercase alphanumeric connection code)
 ├── verified: Boolean (default: true)
 ├── createdAt: Date
 └── updatedAt: Date
```

### 3. Model: `Customer`
```text
Customer
 ├── _id: ObjectId (PK)
 ├── milkman_id: ObjectId (ref: Milkman, required)
 ├── user_id: ObjectId (ref: User, optional, sparse unique index)
 ├── name: String (required)
 ├── email: String (optional, lowercase)
 ├── phone: String (required)
 ├── address: String
 ├── language: String (enum: ['en', 'hi', 'gu'], default: 'en')
 ├── status: String (enum: ['active', 'inactive'], default: 'active')
 ├── startDate: String (YYYY-MM-DD, required)
 ├── endDate: String (YYYY-MM-DD, optional)
 ├── cowRatePaise: Number (integer, required)
 ├── buffaloRatePaise: Number (integer, required)
 ├── morningCowMl: Number (integer, required, default: 1000)
 ├── eveningCowMl: Number (integer, required, default: 0)
 ├── morningBuffaloMl: Number (integer, required, default: 0)
 ├── eveningBuffaloMl: Number (integer, required, default: 0)
 ├── routeMorning: Number (integer, required, default: 0)
 ├── routeEvening: Number (integer, required, default: 0)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ milkman_id: 1, status: 1, routeMorning: 1 }]
 - [{ user_id: 1 }, { unique: true, sparse: true }]
```

### 4. Model: `Record` (`MilkRecord`)
```text
MilkRecord
 ├── _id: ObjectId (PK)
 ├── milkman_id: ObjectId (ref: Milkman, required)
 ├── customer_id: ObjectId (ref: Customer, required)
 ├── date: String (YYYY-MM-DD, required)
 ├── shift: String (enum: ['morning', 'evening'], required)
 ├── type: String (enum: ['cow', 'buffalo'], required)
 ├── quantityMl: Number (integer, required)
 ├── ratePaise: Number (integer, snapshot at time of delivery, required)
 ├── totalPaise: Number (integer, calculated via charge(), required)
 ├── deleted: Boolean (default: false)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ milkman_id: 1, customer_id: 1, date: 1, shift: 1, type: 1 }, { unique: true }]
 - [{ milkman_id: 1, date: 1 }]
```

### 5. Model: `Bill` (`MonthlyBill`)
```text
MonthlyBill
 ├── _id: ObjectId (PK)
 ├── milkman_id: ObjectId (ref: Milkman, required)
 ├── customer_id: ObjectId (ref: Customer, required)
 ├── month: String (YYYY-MM, required)
 ├── openingPaise: Number (integer, required, default: 0 in this increment)
 ├── chargesPaise: Number (integer, sum of Record.totalPaise for month, required)
 ├── paidPaise: Number (integer, allocated payments, required)
 ├── closingPaise: Number (integer, outstanding balance, required)
 ├── currency: String (default: 'INR')
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ milkman_id: 1, customer_id: 1, month: 1 }, { unique: true }]
```

### 6. Model: `Payment`
```text
Payment
 ├── _id: ObjectId (PK)
 ├── milkman_id: ObjectId (ref: Milkman, required)
 ├── customer_id: ObjectId (ref: Customer, required)
 ├── bill_id: ObjectId (ref: MonthlyBill, required)
 ├── amountPaise: Number (integer, min 1, required)
 ├── currency: String (default: 'INR')
 ├── method: String (enum: ['cash', 'upi', 'bank'], required)
 ├── reference: String (optional for cash, required for upi/bank)
 ├── receipt: String (unique, formatted 'GA-<UUID>')
 ├── deleted: Boolean (default: false)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: 'string' } } }]
 - [{ milkman_id: 1, createdAt: -1 }]
```

### 7. Model: `Idempotency` (`IdempotencyKey`)
```text
IdempotencyKey
 ├── _id: ObjectId (PK)
 ├── owner_scope: String (User._id string, required)
 ├── key: String (client-provided Idempotency-Key, required)
 ├── hash: String (SHA-256 hash of URL path + canonical body)
 ├── response: Mixed (cached JSON response object)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ owner_scope: 1, key: 1 }, { unique: true }]
```

### 8. Model: `Otp` (`RegistrationOtp`)
```text
RegistrationOtp
 ├── _id: ObjectId (PK)
 ├── email: String (unique, required)
 ├── hash: String (select: false, HMAC-SHA256 of OTP with JWT_SECRET)
 ├── attempts: Number (default: 0, locked at >= 5)
 ├── expiry: Date (10 minutes from issuance)
 ├── registration: Mixed (select: false, holds pending user payload + bcrypt password)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ expiry: 1 }, { expireAfterSeconds: 0 }] (MongoDB TTL index)
```

### 9. Model: `Audit` (`ActivityLog`)
```text
ActivityLog
 ├── _id: ObjectId (PK)
 ├── milkman_id: ObjectId (optional, tenant scope)
 ├── actor: ObjectId (ref: User, required)
 ├── action: String (e.g. 'customer.created', 'customer.updated', 'POST /records/batch')
 ├── target: String (ID of entity modified)
 ├── requestId: String (UUID from X-Request-Id)
 ├── before: Mixed (state before mutation)
 ├── after: Mixed (state after mutation)
 ├── createdAt: Date
 └── updatedAt: Date
```

### 10. Model: `Onboarding` (`CustomerOnboarding`)
```text
CustomerOnboarding
 ├── _id: ObjectId (PK)
 ├── tokenHash: String (unique, select: false, SHA-256 hash of single-use token)
 ├── registration: Mixed (select: false, holds verified customer registration payload)
 ├── expiry: Date (10 minutes from verification)
 ├── createdAt: Date
 └── updatedAt: Date
Indexes:
 - [{ expiry: 1 }, { expireAfterSeconds: 0 }] (MongoDB TTL index)
```

---

## 10. AUTHENTICATION & AUTHORIZATION FLOW

**CONFIRMED FROM CODE (`backend/src/auth.js`, `middleware.js`, `onboarding.js`):**

### 1. Vendor Registration
1. Vendor submits name, business name, phone, email, password to `POST /api/auth/register`.
2. Password hashed with `bcryptjs` (salt 12).
3. 6-digit cryptographic OTP generated (`crypto.randomInt(100000, 1000000)`).
4. HMAC-SHA256 of OTP stored in `RegistrationOtp` along with registration payload (10 min TTL).
5. Verification email sent via Nodemailer over SMTP (`SMTP_*` settings required; with `DEV_SHOW_OTP=true` in development, the OTP is returned in the response instead and no email is sent).
6. Vendor submits OTP to `POST /api/auth/verify`.
7. Backend validates attempts (< 5), checks expiry, and uses `crypto.timingSafeEqual` on hashes.
8. In an ACID transaction: creates `User` (`role: 'milkman'`) and `Milkman` profile with random 8-character connection `code`. Returns JWT session.

### 2. Customer Registration & Cryptographic History Claiming
1. Customer enters dairy code in `POST /api/auth/dairy/resolve` ➔ resolves business name.
2. Submits details to `POST /api/auth/customer/register` ➔ OTP issued to customer's email.
3. Submits OTP to `POST /api/auth/verify`.
4. Backend verifies email control. Generates random 32-byte `onboardingToken`, hashes it into `CustomerOnboarding`.
5. Queries `Customer` collection for existing profiles matching `milkman_id` and verified `email` with `user_id: { $exists: false }`.
6. Returns `{ onboardingRequired: true, onboardingToken, historyCandidates: [...] }`.
7. Customer selects to claim an existing profile or start fresh in `POST /api/auth/customer/complete`.
8. In an ACID transaction: atomically attaches `user_id` to `Customer` record (or creates new inactive record), creates `User` account (`role: 'customer'`), logs audit entry, and deletes onboarding token.

### 3. Token Format & Session Revocation
* JWT signed with `HS256`, 8-hour expiry, subject is `User._id`, payload contains `sv: user.sessionVersion`.
* On `POST /api/auth/logout`, backend increments `user.sessionVersion`.
* Every authenticated request checks `(payload.sv || 0) !== (user.sessionVersion || 0)`. If mismatched, immediately rejects with HTTP 401 `UNAUTHORIZED`.

### 4. Admin Role-Based Access Control (`backend/src/admin-permissions.js`)
Admin users possess an `adminRole` mapping to specific permissions:
* `super_admin`: `['dashboard.read', 'users.read', 'dairies.read', 'audit.read']`
* `operations`: `['dashboard.read', 'users.read', 'dairies.read']`
* `finance`: `['dashboard.read']`
* `support`: `['users.read', 'dairies.read']`

---

## 11. ENVIRONMENT VARIABLES & CONFIGURATION

**CONFIRMED FROM CODE (`backend/src/server.js`, `scripts/setup-local.cjs`, `.env.example`):**

| Variable | Purpose | Required? | Where Used | Safe to Expose to Frontend? |
|---|---|---|---|---|
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | Yes | Backend, scripts | No |
| `PORT` | API server listening port (defaults to 4000) | No (defaults 4000) | `backend/src/server.js` | No |
| `MONGO_URI` | MongoDB connection string (must include replica set) | Yes | Backend, seed, tests | No (contains credentials) |
| `JWT_SECRET` | Secret key for signing JWTs and OTP HMACs (>= 32 chars) | Yes | `backend/src/auth.js`, `middleware.js` | **NEVER EXPOSE** |
| `CORS_ORIGINS` | Comma-separated allowed web origins | Yes | `backend/src/app.js` | No |
| `REDIS_URL` | Redis connection URL for rate limiting | Production only | `backend/src/server.js`, `app.js` | No |
| `SMTP_HOST` | Outbound mail server hostname (e.g. `smtp.gmail.com`) | Yes (OTP email) | `backend/src/auth.js` | No |
| `SMTP_PORT` | SMTP port (e.g. 587 or 465) | No (defaults 587) | `backend/src/auth.js` | No |
| `SMTP_USER` | SMTP authentication username (full Gmail address for Gmail) | Yes (OTP email) | `backend/src/auth.js` | No |
| `SMTP_PASS` | SMTP authentication password (Gmail App Password) | Yes (OTP email) | `backend/src/auth.js` | No |
| `SMTP_FROM` | Sender address for OTPs; must match `SMTP_USER` for Gmail | Yes (OTP email) | `backend/src/auth.js` | No |
| `DEV_SHOW_OTP` | Returns OTP in API response for automated tests only; keep `false` | No (defaults off) | `backend/src/auth.js` | No |
| `SEED_PASSWORD` | Password for sample `owner@gauamrut.local` account | Dev seed only | `backend/src/seed.js` | No |
| `ADMIN_EMAIL` | Email for bootstrapped super admin | Admin setup only | `backend/src/bootstrap-admin.js` | No |
| `ADMIN_PASSWORD` | Password for bootstrapped super admin | Admin setup only | `backend/src/bootstrap-admin.js` | No |
| `VITE_API_URL` | Base URL for backend API calls from browser | No (defaults :4000) | `frontend/src/lib.js` | Yes (injected in Vite bundle) |

---

## 12. DEPENDENCIES & PACKAGE SCRIPTS

### Root `package.json`
* `concurrently` (^9.2.0): Runs dev servers concurrently.
* `@playwright/test` (^1.63.0): End-to-end browser test framework.
* **Commands:**
  * `npm run setup`: Installs clean dependencies in backend and frontend.
  * `npm start`: Forwards to backend start.
  * `npm run dev`: Forwards to frontend Vite dev server.
  * `npm run dev:all`: Verifies ports 4000 & 5173, then launches backend and frontend concurrently.
  * `npm test`: Runs backend Jest tests and frontend Vitest suite.
  * `npm run lint`: Runs ESLint across backend and frontend.
  * `npm run test:e2e`: Executes Playwright browser suites.

### Backend `package.json`
* **Dependencies:** `express` (4.22.2), `mongoose` (8.19.0), `jsonwebtoken` (9.0.2), `bcryptjs` (3.0.2), `joi` (17.13.3), `helmet` (8.1.0), `cors` (2.8.5), `express-rate-limit` (8.1.0), `rate-limit-redis` (4.2.2), `redis` (5.8.0), `nodemailer` (10.0.3), `dotenv` (16.6.1).
* **Dev Dependencies:** `jest` (30.2.0), `supertest` (7.1.4), `mongodb-memory-server` (10.2.0), `eslint` (9.36.0).
* **Commands:**
  * `npm start`: Runs `node src/server.js`.
  * `npm run dev`: Runs `node --watch src/server.js`.
  * `npm test`: Runs `jest --runInBand`.
  * `npm run lint`: Runs `eslint src test`.
  * `npm run seed`: Seeds sample dairy account with `owner@gauamrut.local`.
  * `npm run bootstrap:admin`: Bootstraps local super-admin user.

### Frontend `package.json`
* **Dependencies:** `react` (18.3.1), `react-dom` (18.3.1), `react-router-dom` (7.18.3), `@reduxjs/toolkit` (2.9.0), `react-redux` (9.2.0), `axios` (1.12.2), `idb` (8.0.3), `lucide-react` (0.468.0).
* **Dev Dependencies:** `vite` (8.3.0), `@vitejs/plugin-react` (6.1.1), `tailwindcss` (3.4.17), `postcss` (8.5.6), `autoprefixer` (10.4.21), `vitest` (5.0.0), `@testing-library/react` (16.3.0), `@testing-library/jest-dom` (6.8.0), `jsdom` (26.1.0), `eslint` (9.36.0).
* **Commands:**
  * `npm run dev`: Starts Vite dev server on `127.0.0.1:5173`.
  * `npm run build`: Builds production static assets into `dist/`.
  * `npm run test`: Runs Vitest test suite.
  * `npm run lint`: Runs ESLint on `src`.

---

## 13. FILE-BY-FILE RESPONSIBILITY MAP

```text
FILE: backend/src/server.js
PURPOSE: Server bootstrap and process life cycle
RESPONSIBILITY: Validates env vars, verifies Mongo replica set, connects Redis, boots Express, handles graceful shutdown.
DEPENDS ON: app.js, models.js, mongoose, redis, dotenv.
USED BY: npm start, Docker/Render runners.

FILE: backend/src/app.js
PURPOSE: Express application factory
RESPONSIBILITY: Sets up middleware pipeline, health check, auth router, admin router, tenant routes, error handling.
DEPENDS ON: express, helmet, cors, middleware.js, auth.js, admin.js, accounts.js, services.js, domain.js.
USED BY: server.js, test/api.test.js, scripts/e2e-api.cjs.

FILE: backend/src/models.js
PURPOSE: Data persistence definitions
RESPONSIBILITY: Exports all 10 Mongoose models with strict validation, indexes, and timestamps.
DEPENDS ON: mongoose.
USED BY: app.js, auth.js, accounts.js, admin.js, services.js, onboarding.js, seed.js.

FILE: backend/src/services.js
PURPOSE: Core transactional business logic
RESPONSIBILITY: Manages writeOnce idempotency, batch delivery insertion, monthly bill generation, and payment recording.
DEPENDS ON: models.js, domain.js, mongoose, crypto.
USED BY: app.js.

FILE: backend/src/domain.js
PURPOSE: Domain math and formatting primitives
RESPONSIBILITY: BigInt safe half-up charge calculation, Kolkata timezone date, canonical hashing, CSV cell escaping.
DEPENDS ON: crypto.
USED BY: app.js, services.js, accounts.js, onboarding.js, seed.js.

FILE: backend/src/auth.js
PURPOSE: Authentication and session routes
RESPONSIBILITY: Vendor/customer registration, OTP issuing and verification, password hashing, login, logout revocation.
DEPENDS ON: models.js, onboarding.js, middleware.js, validation.js, bcryptjs, jsonwebtoken, nodemailer.
USED BY: app.js.

FILE: backend/src/accounts.js
PURPOSE: Account profile and customer updates
RESPONSIBILITY: Profile lookups, customer self-profile edits, vendor customer editing with verified email locking, code rotation.
DEPENDS ON: models.js, middleware.js, validation.js, domain.js.
USED BY: app.js.

FILE: backend/src/admin.js & backend/src/admin-permissions.js
PURPOSE: Super admin console backend
RESPONSIBILITY: Read-only platform metrics, user directory, dairy directory, audit activity log with role-permission checks.
DEPENDS ON: models.js, middleware.js, admin-permissions.js.
USED BY: app.js.

FILE: frontend/src/lib.js
PURPOSE: Frontend state, network, and utilities
RESPONSIBILITY: Configures Axios instance with JWT interceptors, Redux session store, decimalUnits converter, money formatter.
DEPENDS ON: axios, @reduxjs/toolkit.
USED BY: main.jsx, App.jsx, all feature components.

FILE: frontend/src/offline.js
PURPOSE: Offline delivery persistence and sync worker
RESPONSIBILITY: Wraps IndexedDB with idb to enqueue delivery batches, trigger background sync, detect conflicts.
DEPENDS ON: idb, lib.js.
USED BY: App.jsx, Records.jsx.

FILE: frontend/src/hooks/useData.js
PURPOSE: Declarative data-fetching React hook
RESPONSIBILITY: Queries API, provides demo fallback, cancels requests via AbortController, reloads on 'delivery-synced' events.
DEPENDS ON: react, react-redux, lib.js.
USED BY: App.jsx, Records.jsx, Portal.jsx, AdminPortal.jsx.

FILE: frontend/src/features/vendor/Records.jsx
PURPOSE: Daily delivery recording interface
RESPONSIBILITY: Displays route table with prefilled customer quantity defaults, manages daily overrides, offline queuing, unsaved navigation warning.
DEPENDS ON: react, react-redux, offline.js, useData.js, ui.jsx, lib.js.
USED BY: App.jsx.

FILE: frontend/src/features/customer/Portal.jsx
PURPOSE: Customer self-service portal
RESPONSIBILITY: CustomerHome dashboard, CustomerHistory delivery list, CustomerPayments bills/receipts, CustomerProfile editor.
DEPENDS ON: react, react-redux, useData.js, ui.jsx, lib.js.
USED BY: App.jsx.
```

---

## 14. FEATURE INVENTORY & DATA-FLOW TRACES

### Feature 1: Daily Milk Delivery Entry & Offline Sync
* **Frontend:** `Records.jsx` loads active customers via `useData('/customers')`. Defaults for Morning/Evening Cow/Buffalo quantities are pre-filled from customer profile. Milk type dropdown switches between `cow`, `buffalo`, and `both`.
* **User Action:** Milkman adjusts today's volume exceptions on route and taps "Save deliveries".
* **Enqueue:** `offline.js` enqueues the batch in IndexedDB (`gauamrut-deliveries`) with a client-generated UUID `key` and status `'queued'`.
* **Sync:** `syncQueue()` sends HTTP POST to `/api/records/batch` with `Idempotency-Key: <key>`.
* **Backend:**
  1. `writeOnce()` checks `IdempotencyKey`.
  2. Transaction begins. Serializes customer with `$inc: { __v: 1 }`.
  3. Verifies customer eligibility (`startDate <= date`, `endDate >= date`, `status == 'active'`).
  4. Asserts no finalized `MonthlyBill` exists for this month or later (`PERIOD_CLOSED`).
  5. Snapshots current customer rate into `ratePaise`.
  6. Computes `totalPaise = charge(quantityMl, ratePaise)` using BigInt half-up formula.
  7. Creates `MilkRecord` documents. Unique compound index `[milkman_id, customer_id, date, shift, type]` prevents duplicates.
  8. Commits transaction and records audit log.
* **Sync Response:** Frontend receives HTTP 201, deletes batch from IndexedDB, dispatches `delivery-synced` event, and `useData` reloads server records automatically.

### Feature 2: Customer Registration & History Claiming
* **Frontend:** `Auth.jsx` (modes: `resolve` ➔ `customer` ➔ `verify` ➔ `claim`).
* **Data Flow:**
  1. Customer inputs 8-character dairy code. `POST /api/auth/dairy/resolve` confirms business name.
  2. Submits registration details. `POST /api/auth/customer/register` hashes password with bcrypt and emails 6-digit OTP.
  3. Customer enters OTP in `POST /api/auth/verify`.
  4. Backend verifies OTP, generates single-use `onboardingToken` (10 min TTL), and returns candidate customer profiles where `Customer.email == verifiedEmail` and `user_id` is null.
  5. Frontend renders radio choices: "Claim existing account" or "Create new profile".
  6. Customer confirms in `POST /api/auth/customer/complete`.
  7. Backend runs transaction: atomically links `user_id` to the `Customer` record, creates `User` record, and returns signed JWT.

### Feature 3: Monthly Billing & Payment Settlement
* **Frontend:** `App.jsx` (`Payments` component).
* **Generation:**
  1. Vendor chooses customer and billing month (YYYY-MM).
  2. Backend asserts month has ended (`month < today().slice(0, 7)`).
  3. Checks previous month's bill: asserts `previous.closingPaise == 0` (unsettled previous debt must be settled first).
  4. Asserts no unbilled records exist before this month.
  5. Sums all `Record.totalPaise` for the month.
  6. Creates `MonthlyBill` with `closingPaise = chargesPaise`.
* **Payment Allocation:**
  1. Vendor selects finalized bill and enters amount received, method (cash/upi/bank), and transaction reference.
  2. Backend validates amount (`closingPaise >= amountPaise`).
  3. Atomically increments `paidPaise` and decrements `closingPaise`.
  4. Creates `Payment` record with unique receipt number `GA-<UUID>`.

---

## 15. EXISTING CODING CONVENTIONS & STYLE GUIDE FOR AGENTS

To ensure Antigravity writes code that looks identical to the existing codebase, adhere to these concrete patterns:

### 1. Naming Conventions
* **Files & Directories:**
  * Components: PascalCase (`CustomerEditor.jsx`, `AdminPortal.jsx`, `DairyProfile.jsx`).
  * Backend modules & scripts: kebab-case (`check-dev-ports.cjs`, `admin-permissions.js`, `bootstrap-admin.js`) or single words (`models.js`, `app.js`, `lib.js`).
  * Test files: `*.test.js`, `*.test.jsx`, `*.spec.cjs`.
* **Variables & Functions:** camelCase (`enterDeliveries`, `decimalUnits`, `cowRatePaise`, `morningCowMl`).
* **Error Codes:** Screaming snake case strings (`VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`, `PERIOD_CLOSED`, `VERIFIED_EMAIL_LOCKED`).
* **Database IDs:** `_id` for document primary keys, `user_id`, `milkman_id`, `customer_id`, `bill_id` for foreign keys.

### 2. Code Organization & Density
* The existing code is exceptionally concise, elegant, and dense. It avoids gratuitous boilerplate.
* Async route handlers are always wrapped using the `wrap(fn)` higher-order function:
  ```javascript
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  ```
  *(Never write manual `try/catch` inside route handlers unless performing explicit retry loops).*
* Standard response helper:
  ```javascript
  const ok = (res, data, meta) => res.json({ success: true, data, ...(meta ? { meta } : {}) });
  ```

### 3. Number Representation Rule
* **NEVER** use floating-point numbers in backend calculations or schemas for currency and milk volumes.
* Always use integer `paise` (1 INR = 100 paise) and integer `millilitres` (1 Litre = 1000 ml).
* Use the frontend `decimalUnits(value, scale)` function in `lib.js` to convert user inputs (`"1.5"` Litres ➔ `1500` ml, `"65.50"` INR ➔ `6550` paise).

---

## 16. STATE MANAGEMENT ARCHITECTURE

* **Client Session State:** Redux Toolkit `session` slice (`token`, `user`, `demo`). Token is in-memory only.
* **Persistent Offline Queue:** IndexedDB database `gauamrut-deliveries`, object store `queue`.
* **Server State:** Handled via `useData(path, example)` hook with automatic abort signals and re-fetch triggers.
* **Component Local State:** `useState` for form fields, modal toggles, search filters, and active pagination pages.

---

## 17. ERROR HANDLING & RESPONSE ENVELOPES

### Backend JSON Envelopes
* **Success Envelope:**
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { "total": 100, "page": 1, "limit": 50 }
  }
  ```
* **Error Envelope:**
  ```json
  {
    "error": {
      "code": "PERIOD_CLOSED",
      "message": "This period has been billed. Corrections require a future adjustment workflow."
    }
  }
  ```

### Frontend Error Extraction
Frontend extracts messages uniformly using `message(error)` from `frontend/src/lib.js`:
```javascript
export const message = error =>
  error.response?.data?.error?.message ||
  (error.code === 'ERR_NETWORK' ? 'Cannot reach the API. Check that the backend is running, then retry.' : error.message || 'Something went wrong. Please retry.');
```

---

## 18. SECURITY POSTURE & VULNERABILITY ANALYSIS (READ-ONLY AUDIT)

A rigorous read-only security audit of the repository reveals:

1. **Timing-Safe OTP Comparison (LOW RISK / SECURE):**
   * `auth.js` uses `crypto.timingSafeEqual(Buffer.from(candidate.hash), Buffer.from(otpHash(req.body.otp)))` to prevent timing attacks.
2. **Session Revocation (LOW RISK / SECURE):**
   * Server maintains `sessionVersion` on `User` documents. Logging out increments this counter, immediately invalidating active JWTs.
3. **Verified Email Immutability (LOW RISK / SECURE):**
   * `accounts.js` prevents a dairy owner from modifying the email of an already-linked customer profile (`VERIFIED_EMAIL_LOCKED`).
4. **CSV Injection Defense (LOW RISK / SECURE):**
   * `domain.js` sanitizes formula characters (`=`, `+`, `-`, `@`) in CSV export generation.
5. **In-Memory JWT Storage (MEDIUM RISK / TRADE-OFF):**
   * **Confirmed:** JWT is stored only in Redux in-memory state. While this shields against XSS token harvesting from `localStorage`, page refresh wipes the session and requires the user to log in again.
6. **Rate Limiting Fallback (INFORMATIONAL):**
   * In development, rate limiting falls back to in-memory memory store when Redis is absent. Production enforces Redis.

---

## 19. CURRENT TECHNICAL DEBT, RISKS & KNOWN GOTCHAS

1. **MongoDB Replica Set Mandatory:**
   * Running `mongod` as a standalone instance will cause backend startup to fail. Multi-document transactions (`session.withTransaction`) mandate a replica set.
2. **Delivery Entry is Append-Only in Current Release:**
   * There are currently no endpoints for updating, correcting, or soft-deleting recorded deliveries once saved. Billed months cannot be modified (`PERIOD_CLOSED`).
3. **Sequential Bill Settlement Constraint:**
   * Generating a new bill requires the previous month's bill to have `closingPaise === 0`. Full carry-forward ledger allocation is scheduled for Milestone 3.
4. **Customer Picker 100-Limit in Bill Modal:**
   * `Payments()` in `App.jsx` fetches `/customers?limit=100`. For dairies with more than 100 customers, a searchable picker is needed.
5. **Single CSS File:**
   * All application styles reside in `frontend/src/styles.css` (24KB). While structured and clean, additions should preserve existing class names and responsive rules.

---

## 20. IMPLEMENTED VS. DEFERRED (ROADMAP BREAKDOWN)

| Feature Area | Current Implemented Status | Deferred / Pending Work (Per ROADMAP.md) |
|---|---|---|
| **Auth** | Vendor & customer OTP registration, history linking, JWT login, session revocation | Refresh tokens, password reset workflow |
| **Customer Mgmt** | Create, edit rates/defaults, toggle active/inactive, dairy code regeneration | Validated route drag-and-drop reordering |
| **Deliveries** | Transactional batch entry, cow/buffalo/both selection, shift defaults, offline queue | Delivery corrections, soft deletion diffs, vacation pause rules |
| **Offline** | IndexedDB queue, retry worker, conflict detection | Cache customer directory offline, cold-start offline login |
| **Billing** | Completed-month bill generation, integer charges | Carry-forward debt ledger, automatic monthly scheduler |
| **Payments** | Cash/UPI/bank recording, receipt generation, overpayment block | Customer payment dispute flow, payment gateway integration |
| **Reports** | Monthly delivery CSV download (up to 5,000 rows) | PDF bill generation, summary ledger reports |
| **Admin** | Read-only platform metrics, user directory, dairy directory, audit log | Account suspension, role editing, financial admin actions |
| **Localization** | Language preference saved on customer profile (`en`, `hi`, `gu`) | Complete UI translations (i18n) for Hindi and Gujarati |

---

## 21. IMPORTANT "DO NOT BREAK" INVARIANTS

1. **Do NOT use floating-point numbers for money or volume.** Always store and calculate using integer paise and millilitres with the `charge()` BigInt half-up formula.
2. **Do NOT remove `Idempotency-Key` headers.** Every ledger-modifying mutation requires idempotency tracking.
3. **Do NOT bypass tenant scoping.** Every database query must incorporate `milkman_id: req.tenant` (and `customer_id` for customers).
4. **Do NOT store JWT in `localStorage` or `cookies`.** Keep token management within the Redux session slice.
5. **Do NOT remove MongoDB transactions.** All ledger writes, onboarding links, and code rotations must execute inside `session.withTransaction()`.

---

## 22. LOCAL DEVELOPMENT WORKFLOW & VERIFIED COMMANDS

### Initial Local Machine Setup (Windows)
```powershell
# 1. Clean installation of dependencies across all workspaces
npm.cmd ci
npm.cmd run setup

# 2. Generate local environment files with a random JWT secret
node scripts/setup-local.cjs

# 3. Start local development MongoDB replica set on port 27018
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-mongo.ps1
```

### Running the Application
```powershell
# Option A: Run concurrently (checks ports 4000 & 5173 first)
npm.cmd run dev:all

# Option B: Run in separate terminals
# Terminal 1 (Backend API on http://127.0.0.1:4000)
npm.cmd --prefix backend start

# Terminal 2 (Frontend on http://127.0.0.1:5173)
npm.cmd --prefix frontend run dev
```

### Seeding Development Sample Data
```powershell
$env:SEED_PASSWORD = 'local-password-123'
npm.cmd --prefix backend run seed
Remove-Item Env:SEED_PASSWORD
# Sign in as owner@gauamrut.local with the chosen password
```

### Verification & Test Suite
```powershell
# Run ESLint on backend and frontend
npm.cmd run lint

# Run unit and integration tests (38 backend, 2 frontend)
npm.cmd test

# Build production frontend bundle
npm.cmd run build

# Run Playwright E2E browser tests
npm.cmd run test:e2e
```

---

## 23. GIT CONFIGURATION & PATTERNS

**CONFIRMED FROM CODE:**
* **Git Repository Status:** Git repository is not currently initialized in `d:/Projects/GauAmrut`.
* **`.gitignore`:** Explicitly ignores `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*` (except `.env.example`), `*.log`, `.local/`, `test-results/`, and `playwright-report/`.

---

## 24. DOCUMENTATION AUDIT

* **`README.md`:** Highly accurate. Reflects current port configurations (4000 backend, 5173 frontend, 27018 replica set), setup commands, and architectural limits.
* **`docs/ROADMAP.md`:** Accurately documents current vs. future milestones (Milestones 1 & 2 partial implemented, Milestones 3 & 4 planned).
* **`docs/VERIFICATION.md`:** Documents verified test baseline (43 total automated tests passing).
* **`docs/openapi.json`:** Comprehensive OpenAPI 3.1.0 specification kept up-to-date via `scripts/generate-openapi.cjs`.

---

## 25. SYSTEM ARCHITECTURE DIAGRAM

```text
                                 BROWSER CLIENT (React 18 + Vite)
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼                                                             ▼
        [Online HTTP Channel]                                        [Offline IndexedDB]
                 │                                                             │
         Axios API Client                                           idb: 'gauamrut-deliveries'
     (Bearer JWT Interceptor)                                         (Delivery Sync Queue)
                 │                                                             ▲
                 │                                                             │ (Reconnect retry)
                 ▼                                                             │
      EXPRESS BACKEND (Port 4000) ─────────────────────────────────────────────┘
  ┌────────────────────────────────────────────────────────────────────────────┐
  │ Middleware Pipeline: Helmet -> CORS -> RequestId -> RateLimit (Redis Store)│
  │ Auth Guard: JWT Verify (HS256) -> SessionVersion Check -> Customer Linkage │
  │ Tenant Isolation: req.tenant = user.milkman_id -> scope(req)               │
  └──────────────────────┬───────────────────────────────┬─────────────────────┘
                         │                               │
                         ▼                               ▼
               [Idempotent Services]            [Express Route Handlers]
           (writeOnce: SHA-256 Check)           (Accounts, Auth, Admin)
                         │                               │
                         └───────────────┬───────────────┘
                                         │
                                         ▼
                             MONGODB 8.x REPLICA SET
                                   (Port 27018)
           ┌─────────────────────────────┼─────────────────────────────┐
           ▼                             ▼                             ▼
   [Core Entities]               [Financial Ledger]            [Security & Logs]
   - User                        - MilkRecord                  - RegistrationOtp (TTL)
   - Milkman                     - MonthlyBill                 - IdempotencyKey
   - Customer                    - Payment                     - ActivityLog (Audit)
                                                               - CustomerOnboarding (TTL)
```

---

## 26. RULES FOR ANTIGRAVITY (CONTINUATION MANDATES)

When continuing development on GauAmrut, Antigravity **MUST** adhere to the following rules:

1. **Preserve the Monorepo Structure:** Keep backend code in `backend/src/` and frontend code in `frontend/src/`.
2. **Preserve Strict Integer Arithmetic:** Never introduce floats for money or milk quantities. Always use BigInt half-up rounding via `charge()`.
3. **Preserve MongoDB Multi-Document Transactions:** Always execute multi-document mutations inside `session.withTransaction()`.
4. **Preserve Idempotency on Mutating Endpoints:** Always wrap ledger operations in `writeOnce()`.
5. **Preserve In-Memory JWT Authentication:** Do not move tokens to `localStorage` or `cookies` unless explicitly requested.
6. **Preserve Session Version Revocation:** Ensure `sessionVersion` remains checked in `middleware.js` and incremented on logout.
7. **Preserve Verified Email Locking:** Never allow changing a customer's email once linked to a user account.
8. **Preserve Multi-Tenant Scoping:** Always apply `milkman_id: req.tenant` (and `customer_id` for customers).
9. **Preserve Existing UI Styling & Design Tokens:** Use the color palette (`--green: #176348`, background `#f7f9f6`, `#263d35`), typography (`DM Sans` and `Manrope`), and card/modal patterns defined in `styles.css`.
10. **Preserve Offline Sync Behavior:** Do not break the IndexedDB queue in `frontend/src/offline.js` or the `'delivery-synced'` event dispatch.
11. **Do NOT Introduce Redundant Libraries:** Do not add Tailwind UI kits, secondary state libraries (e.g. Zustand), or alternative ORMs.
12. **Reuse Existing Primitives:** Use `<Notice>`, `<State>`, `<Heading>`, `<Modal>`, `<Field>`, and `useData()` instead of rebuilding UI components.
13. **Run Existing Checks Before Declaring Done:** Verify code changes with `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build`.

---

## 27. RECOMMENDED STEP-BY-STEP STRATEGY FOR NEXT TASKS

When prompted to build the next feature from `docs/ROADMAP.md`:
1. **Identify the Target Task:** Check `docs/ROADMAP.md` (e.g., Milestone 2 delivery corrections, customer payment dispute submission, or Hindi/Gujarati i18n).
2. **Trace the Dependent Data Flow:** Review the database models involved in `backend/src/models.js`.
3. **Implement Backend Schema & Joi Validation:** Add new fields or schemas to `models.js` and `validation.js`.
4. **Implement Transactional Service:** Place business logic in `services.js` or `accounts.js` with `writeOnce` or `change()`.
5. **Expose Express Route:** Connect route in `app.js` using `auth`, `vendor`/`customer` guards, and `wrap()`.
6. **Write Automated Backend Test:** Add integration test cases in `backend/test/api.test.js`.
7. **Implement Frontend View & State:** Update or create components in `frontend/src/features/` matching the visual system in `styles.css`.
8. **Verify with Lint, Test & Build:** Execute `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build`.

---

## 28. UNKNOWN / NEEDS HUMAN CONFIRMATION

* **Production SMTP & Redis Credentials:** Not present in repository (templates provided in `.env.example`).
* **Production WhatsApp Provider:** Mentioned in SRS for delivery notifications; specific API provider (Twilio, Meta Cloud API, Gupshup) is not yet selected.
* **Online Payment Gateway:** Razorpay / Cashfree mentioned in SRS; API keys and webhook architecture are deferred to Milestone 3.

---

## 29. FINAL PROJECT SUMMARY

* **Project Name:** GauAmrut
* **Application Category:** Full-stack Dairy Logistics, Delivery Tracking & Billing Platform
* **Frontend:** React 18, Vite 8, React Router v7, Redux Toolkit, Tailwind CSS, Lucide Icons, idb (IndexedDB)
* **Backend:** Node.js 24, Express 4.22, Mongoose 8.19, Redis 5.8, Nodemailer, Joi, JWT, bcryptjs
* **Database:** MongoDB (mandatory replica set for transactions)
* **Authentication:** Email OTP verification, verified-email account claiming, in-memory JWT, session version revocation
* **Status:** Working vendor core + customer onboarding & self-service portal (Milestones 1 & 2 partially complete per ROADMAP.md)
* **Audit Execution:** 100% complete, read-only inspection. Project source code left completely untouched.
