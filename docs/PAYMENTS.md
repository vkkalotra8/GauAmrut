# Payment Methodology

How money is measured, billed, initiated, reconciled and corrected in GauAmrut.
This is a reference for anyone touching `Bill`, `PaymentIntent`,
`PaymentRequest`, `Payment` or `Adjustment`.

**There is no payment gateway or automatic bank verification.** GauAmrut creates
a standards-compatible `upi://pay` URI and QR from the dairy's configured UPI
ID, but the transfer still happens entirely in the customer's UPI app. The QR is
an initiation convenience, not proof of settlement. Only authorized dairy staff
may credit the ledger after checking the actual receiving bank/UPI account.

---

## 1. Design principles

| Principle | How it is enforced |
|---|---|
| **Never lose precision** | Every monetary value is an integer of paise. No floats, no rounding at rest. |
| **Never double-apply an action** | `Idempotency-Key` on the three ledger writes; `ALREADY_REVERSED` guards on both reversals. |
| **Never trust a client total** | The server recomputes charges from `Record` documents; the client only supplies a paise amount it asserts was paid. |
| **Never orphan a tenant** | Every query is scoped by `milkman_id` (`scope()`, `middleware.js:20`). |
| **Every mutation is auditable** | `change()` and `writeOnce()` both write an `ActivityLog` row with `before`/`after` inside the same transaction. |

---

## 2. Currency and money handling

### 2.1 Storage

Every amount is a **non-negative safe integer in paise** — validated by the
schema helper `integer()` (`models.js:4`) and rejected as `INVALID_AMOUNT` if a
value is ever not a non-negative safe integer.

Field naming is consistent and meaningful:

| Suffix | Meaning |
|---|---|
| `*Paise` | Rupee fraction ×100 (e.g. `amountPaise`, `closingPaise`) |
| `*RatePaise` | Paise **per litre** |
| `quantityMl` | Millilitres (integer, not paise) |

`currency` is fixed to `'INR'` on `Bill`, `PaymentIntent`, `PaymentRequest` and `Payment`. There
is no conversion logic anywhere; the currency cannot be changed without a schema
migration.

### 2.2 Computing a line charge

`charge(quantityMl, ratePaise)` — `domain.js:5-10`:

```js
const total = (BigInt(quantityMl) * BigInt(ratePaise) + 500n) / 1000n;
```

`ml × paise-per-litre ÷ 1000`, rounded **half-up**, performed in `BigInt` so a
large quantity/rate pair can never overflow or silently lose a paise. The result
must still fit `Number.MAX_SAFE_INTEGER`.

### 2.3 Converting at the two UI boundaries

- **In** — `decimalUnits(value, scale = 100)` (`lib.js:12-20`) validates
  `^\d+(\.\d{1,3})?$`, caps the fraction to 2 digits for money, then returns
  `whole * 100 + fraction`. Rejects negatives, malformed input and overflow
  *before* the request leaves the browser.
- **Out** — `money(value)` (`lib.js:9`) is a single `Intl.NumberFormat('en-IN',
  { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })` over
  `value / 100`, giving Indian lakh/crore grouping. It is the only currency
  formatter in the codebase.

**Rule of thumb:** paise integers touch the database and the API; rupee decimals
touch only the DOM, at input and display.

---

## 3. The ledger

### 3.1 The equation

```
closingPaise = openingPaise + chargesPaise - paidPaise ± adjustments
```

- `openingPaise` — the previous month's `closingPaise`, or
  `Customer.openingBalancePaise` for the first bill. This is the carry-forward.
- `chargesPaise` — sum of `totalPaise` over that month's non-deleted `Record`s.
- `paidPaise` — running total of `Payment`s applied to *this* bill.
- adjustments — mutate `closingPaise` directly (see §6).

A customer with no payments and no adjustments always has
`opening + charges === closing`, which makes a bill trivially auditable.

### 3.2 The chain

Bills form an unbroken chain per customer. Three rules keep it coherent
(`services.js:69-94`):

| Guard | Code | Meaning |
|---|---|---|
| No future months | `FUTURE_MONTH` | You cannot bill a month that has not started. |
| Chronological only | `BILL_ORDER` | A bill cannot be created if any later month already has one. |
| No gaps | `EARLIER_UNBILLED_RECORDS` | Deliveries exist before this month that were never billed — bill the earlier month first. |

These three together make the carry-forward trustworthy: `opening` is always the
true previous balance because there is always a previous bill.

### 3.3 Regeneration refreshes, never duplicates

Calling `POST /bills` for a month that already has a bill does **not** create a
second one. It calls `refreshBilledMonths()` (`services.js:98-129`), which:

1. Recomputes `chargesPaise` for that month from current `Record`s.
2. Re-derives `openingPaise` from the prior bill's closing.
3. **Cascades** the corrected closing into every later month, so a fix in March
   repairs April and May automatically.
4. Preserves the net effect of applied adjustments (§6.3) so a refresh can never
   erase a manual ledger correction.

This is why the current month keeps accepting deliveries after a mid-month bill:
regeneration picks them up.

### 3.4 What is *not* in the ledger

- **Product orders** — `Order.totalPaise` exists, but `chargesPaise` sums only
  milk `Record` documents. Commerce is tracked separately and, if it needs to
  reach the ledger, is entered as a debit adjustment (§6).
- **Disputes** — a dispute thread is conversational. Resolving it does not move
  money; a human applies an adjustment.
- **Delivery adjustments** (vacation pauses, extra deliveries) — these alter what
  gets *recorded* going forward, not what is already billed.

---

## 4. Recording a payment

`POST /payments` → `recordPayment()` (`services.js:149-191`), guarded by
`vendor` (dairy staff only) and wrapped in `writeOnce()`.

### 4.1 Targeting

The payload must contain `bill_id` **or** `customer_id` (Joi `.or()`),
never neither, never silently both-with-conflicting-meaning:

- **`bill_id` given** — that bill must exist in the caller's tenant, and
  `amountPaise <= closingPaise`, else `409 INVALID_PAYMENT`.
- **`customer_id` only** — the server finds the **oldest** bill with
  `closingPaise > 0` and applies the payment there. If none, `409
  NO_OUTSTANDING_BILLS`; if the amount exceeds that bill, `409 INVALID_PAYMENT`.

The second form is what makes "record ₹500 for Meera" safe: the money lands on
the oldest debt, deterministically, without the caller needing to know which
month is outstanding.

### 4.2 Applying

```js
targetBill.paidPaise += amountPaise;
targetBill.closingPaise -= amountPaise;
```

Then a `Payment` row is written with `receipt: 'GA-' + crypto.randomUUID()` —
globally unique via a schema index. The payment stores an immutable
`balanceAfterPaise` snapshot. `refreshBilledMonths()` then cascades the changed
closing balance into every later bill, preserving chronological carry-forward.
The response also carries `balanceBeforePaise` and `billMonth`. Reversal uses
the same cascade in the opposite direction.

### 4.3 Idempotency

`writeOnce()` (`services.js:5-37`) **requires** an `Idempotency-Key` header
matching `^[\w-]{8,128}$`:

- Same key + same request fingerprint → the **stored response** is replayed. A
  double-tapped "Save" charges once.
- Same key + *different* body → `409 IDEMPOTENCY_CONFLICT`.
- Key is inserted **before** the ledger work runs, so concurrent uses of one key
  contend on the unique index rather than on the bill.

The frontend generates a fresh key when the payment modal opens and regenerates
it on every form change (`Payments.jsx:54, 821`), so the key is scoped to one
distinct *intent*, not to a user session.

> `Idempotency-Key` is mandatory on deliveries, bill generation, payments and
> payment-intent creation. Reversals, adjustments and claim reviews use
> `change()` instead. Reversals have an `ALREADY_REVERSED` guard; claim approval
> links one payment transactionally and safely replays that existing payment
> after a retry or concurrent approval.

### 4.4 Method and reference

| `method` | `reference` |
|---|---|
| `cash` | optional |
| `upi`, `bank` | **required**, 3–100 chars (`validation.js:11`) |

`reference` carries the UPI UTR or bank reference — the number that makes a
record reconcilable against a real bank statement.

---

## 5. Reversing a payment

`POST /payments/:id/reverse` (`app.js:232-261`).

- Requires a `reason` of 3–255 characters. No silent undo.
- `404 NOT_FOUND` if missing; `409 ALREADY_REVERSED` if the payment is already
  reversed.
- Restores the bill: `closingPaise += amountPaise` and
  `paidPaise = Math.max(0, paidPaise - amountPaise)`.
- Sets `reversed`, `reversalReason`, `reversedAt`, `reversedBy`.

**Reversal is soft.** The `Payment` row is never deleted — it stays with its
receipt number, flagged, so the audit trail and any receipt already handed to the
customer remain coherent. Reversed payments are excluded from outstanding and
report totals via `reversed: false` filters.

The UI reinforces this: the Reverse button is only rendered when `!p.reversed`
(`Payments.jsx:572-580`), and the modal warns that reversal restores the
outstanding balance.

---

## 6. Adjustments

`POST /adjustments` (`app.js:324-380`). These are the manual ledger corrections a
dairy applies for goodwill, damage, discounts, or money returned.

### 6.1 The four types

| Type | Effect on `closingPaise` | Default target bill | Cap |
|---|---|---|---|
| `credit` | **reduces** (customer pays less) | oldest bill with `closingPaise > 0` | cannot exceed that bill's closing |
| `waiver` | **reduces** (forgiven) | oldest bill with `closingPaise > 0` | cannot exceed that bill's closing |
| `debit` | **increases** (extra charge) | newest bill | — |
| `refund` | **increases** (money returned, so debt returns) | newest bill | — |

Credits/waivers target the *oldest* debt, matching how payments allocate.
Debits/refunds target the *newest* bill, because a fresh charge belongs to the
current period.

Failure codes: `409 NO_OUTSTANDING_BILLS` (credit/waiver with nothing to credit),
`409 INVALID_ADJUSTMENT` (credit exceeds the bill), `409 NO_BILLS_FOUND`
(debit/refund with no bills at all).

A `reason` of 3–255 characters is **always required** — an adjustment with no
stated reason is not allowed to exist. `reference` is optional free text (UTR,
ticket number, etc).

### 6.2 Reversing an adjustment

`POST /adjustments/:id/reverse` (`app.js:381-413`) — requires a reason, refuses
to reverse twice (`409 ALREADY_REVERSED`), and applies the inverse:

- credit/waiver → `closingPaise += amountPaise`
- debit/refund → `closingPaise = Math.max(0, closingPaise - amountPaise)`

The `Math.max(0, …)` prevents a reversal from manufacturing a negative balance.

### 6.3 Adjustments survive regeneration

Because adjustments mutate `closingPaise` directly rather than flowing through
`paidPaise`, a bill regeneration would normally wipe them out.
`refreshBilledMonths()` guards against exactly this (`services.js:103-110`): it
loads all `applied` adjustments for the affected bills, builds a per-bill delta
map (credits/waivers negative, debits positive), and re-applies the net effect
after recomputing the base.

---

## 7. UPI initiation and payment claims

The customer flow deliberately separates **initiation**, **claimed settlement**
and **verified ledger payment**.

### 7.1 Creating a UPI payment intent

`POST /payment-intents` is authenticated and customer-only. The server verifies
tenant, customer and bill ownership; reads the dairy's configured `upiId`; and
uses the authoritative bill balance. A partial amount is allowed only when it is
positive and no greater than the outstanding bill balance.

A persisted `PaymentIntent` stores tenant, customer, bill, integer paise amount,
payee snapshot, unique internal reference, expiry and linked claim. The response
contains the encoded `upi://pay` URI, generated QR data URL, exact amount and
payee identity. It always reports settlement as unverified. The internal
reference is for reconciliation context only; UPI apps are not trusted to return
it unchanged.

Creation uses the existing `Idempotency-Key` transaction mechanism. Replaying the
same key and request returns the same intent. Launching a UPI app, scanning the
QR, or reaching `expiresAt` never marks a payment successful or failed.

### 7.2 Customer experience and claim submission

The customer Bills & Payments page provides Pay now, desktop QR, mobile UPI
handoff, copy controls, instructions and a Submit payment details action. The
intent amount and bill are carried into the claim form and cannot be silently
changed.

`POST /payment-claims` accepts customers and dairy staff. It validates customer,
tenant, bill, intent, integer amount and a restricted 3–100 character reference.
References are canonicalized for case-insensitive, tenant-scoped uniqueness. The
claim and intent link are written transactionally; the ledger remains untouched.

An expired intent may still represent real money sent externally, so its claim is
accepted as evidence. If the bill balance changed after initiation, the claim is
stored as `reconciliation_required` with the original evidence instead of being
discarded. Manual claims that exceed the current eligible balance are rejected.

### 7.3 Dairy verification

`PATCH /payment-claims/:id/review` is dairy-staff-only. Approval requires
`settlementConfirmed: true`, representing the staff member's explicit assertion
that they checked the actual receiving account. The app itself does not contact
or scrape any bank.

Approval runs in one audited MongoDB transaction. It revalidates tenant,
customer, bill and balance; updates the bill; cascades carry-forward balances;
creates the existing `Payment` and receipt; links the claim; and notifies the
customer. Concurrent or repeated approval returns the already-linked payment
without applying the ledger or notification twice.

Rejecting requires a reason and never changes the ledger. If a genuine payment
cannot fit the current bill, approval records or preserves a
`reconciliation_required` exception. Authorized staff must resolve the ledger
condition or reject with an explanatory reason; evidence is never silently lost.

---

## 8. Provisional "till-date" statements

A month that hasn't closed still needs to be visible. `billStatement()`
(`services.js:201-252`) produces one of two things:

- **A finalized bill exists** → returned verbatim with `provisional: false`.
- **Not** → a statement composed on the fly with `provisional: true`:

```
priorClosing = previous bill's closingPaise, or customer.openingBalancePaise
paidThisMonth = payments made this month against that previous bill
opening      = priorClosing + paidThisMonth    // roll back the payments
charges      = deliveries recorded this month
closing      = opening + charges - paidThisMonth
```

The roll-back is the subtle part: `previous.closingPaise` already nets off the
payments applied to it, so those payments are added back to recover the balance
as it stood at the start of the month. The arithmetic then nets them off again.

**Payments are not accepted against a provisional statement.** The vendor UI
withholds the Record-payment button on provisional rows and on settled bills
(`Payments.jsx:428-434`); payments always target a real `Bill`.

---

## 9. Batch billing

`POST /bills/batch-generate` → `runMonthlyBillingScheduler()`
(`billing-scheduler.js:40-129`).

- **Month defaults to the previous calendar month** — this is the "close last
  month" button.
- A **distributed lock** keyed `billing_scheduler_<tenant>_<month>` with a 120 s
  lease prevents two concurrent runs from double-billing. Contention is `409
  SCHEDULER_LOCKED`. The lock document carries a TTL index, so stale leases
  self-expire.
- For each active customer, in its own Mongo transaction:
  - Bill already exists → `refreshBilledMonths` (counted as *updated* or
    *skipped*).
  - New bill → carry forward the prior closing, sum the month's charges.
  - **Skipped** when both `chargesPaise === 0` and `openingPaise === 0` — a
    customer with no deliveries and no debt gets no bill.
- Per-customer failures are collected into `summary.errors` rather than aborting
  the run, so one bad customer can't block everyone else's billing.

The response summary is `{ targetMonth, generated, updated, skipped, errors }`.

---

## 10. Concurrency and integrity

Three mechanisms, deliberately layered:

| Mechanism | Protects against | Used by |
|---|---|---|
| `writeOnce()` — idempotency key + transaction + audit | Duplicate submissions, double-charging | deliveries, bill generation, payments |
| `change()` — transaction + `before`/`after` audit row | Partial writes; untraceable edits | reversals, adjustments, claim reviews, disputes |
| `Customer.__v` version touch | Interleaved billing and delivery writes on one customer | all billing paths |
| `DistributedLock` (TTL) | Two schedulers billing the same month | monthly batch billing |

`change()` (`accounts.js:9-20`) is worth reading closely: it runs the operation
and the `Audit` insert inside one `withTransaction`, so a mutation and its audit
record commit or roll back together. There is no state in which money moved but
the activity log has no entry of it.

### Tenancy

`scope(req)` = `{ milkman_id: req.tenant }`, plus `customer_id: req.user.customer_id`
for customer-role sessions (`middleware.js:20`). Every read is filtered by it.
A customer literally cannot construct a query that returns another dairy's or
another customer's ledger.

### Authorization

- **Dairy staff** (`vendor` middleware): record payments, reverse payments,
  create/reverse adjustments, generate bills, review claims.
- **Customers**: submit claims, view their own bills/statements/receipts/claims/
  adjustments, download and share PDFs. They have **no** reverse, approve,
  reject or adjust controls at all — enforced server-side, not merely hidden.

---

## 11. Receipts

`GET /payments/:id/receipt` (`app.js:262-295`) returns everything needed to render
a standalone, printable receipt:

- receipt code, date, method, reference/UTR, amount, currency
- the billing month the payment was applied to
- `reversed`, `reversalReason`, `reversedAt`
- dairy identity — business name, owner, phone, **UPI id**
- customer identity — name, phone, address
- `balanceAfterPaise` — immutable post-payment balance for newly created
  receipts; legacy payments return `null`
- `currentBillBalancePaise` — explicitly labelled current bill balance
- `balanceAfterIsHistorical` — whether the immutable snapshot exists
- `verified: true`

Both the vendor and customer apps render this as a modal with a print button
(`Payments.jsx:864-938`, `Portal.jsx:794-861`). The vendor variant also renders a
REVERSED banner; the reversed state reaches the customer only as a badge in their
history table.

The bill PDF (`GET /bills/:id/pdf`, or `GET /bills/statement.pdf` for provisional)
is generated by `generateBillPdf()` (`pdf.js:303`) and includes a summary box plus
the delivery line items, paginated when a month has too many entries to fit.

### Sharing

Bills and receipts can be shared through the **native OS share sheet**
(`share.js`, `ShareReportButton.jsx`) with the PDF as a file. Where the browser
has no `navigator.share`, it falls back to one download plus an unpinned
`wa.me` link, and says so. The dairy can also send a bill to a specific number
through the linked WhatsApp session (`POST /whatsapp/send-document`).

---

## 12. API reference

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/bills` | scoped | paginated, newest month first |
| `POST` | `/bills` | vendor | generates **or refreshes**; requires `Idempotency-Key` |
| `POST` | `/bills/batch-generate` | vendor | month optional, defaults to previous month |
| `GET` | `/bills/:id/pdf` | scoped | finalized bill PDF |
| `GET` | `/bills/statement` | scoped | one customer, one month; may be provisional |
| `GET` | `/bills/statements` | vendor | batch till-date statements for all customers |
| `GET` | `/bills/statement.pdf` | scoped | provisional statement PDF |
| `GET` | `/payments` | scoped | paginated |
| `POST` | `/payment-intents` | customer | authenticated bill-specific UPI URI/QR; requires `Idempotency-Key` |
| `POST` | `/payments` | vendor | requires `Idempotency-Key` |
| `POST` | `/payments/:id/reverse` | vendor | reason required, irreversible once done |
| `GET` | `/payments/:id/receipt` | scoped | receipt payload |
| `GET` | `/adjustments` | scoped | filterable by `customer_id`, `type`, `status` |
| `POST` | `/adjustments` | vendor | credit/waiver/debit/refund |
| `POST` | `/adjustments/:id/reverse` | vendor | reason required |
| `POST` | `/payment-claims` | customer+vendor | UTR uniqueness per dairy |
| `GET` | `/payment-claims` | scoped | customers see only their own |
| `PATCH` | `/payment-claims/:id/review` | vendor | approval requires settlement attestation; safe replay |
| `GET` | `/reports/payments.csv` | vendor | month, excludes reversed from totals |
| `GET` | `/reports/payments.pdf` | vendor | same data as PDF |
| `GET` | `/admin/reports/payments.csv` | `reports.read` | platform-wide across all dairies |
| `GET` | `/admin/reports/payments.pdf` | `reports.read` | platform-wide |

---

## 13. Data model

| Model | Money fields | Key state |
|---|---|---|
| `Customer` | `cowRatePaise`, `buffaloRatePaise`, `openingBalancePaise` | `status`, `startDate`, `endDate` |
| `MilkRecord` | `ratePaise`, `totalPaise`, `quantityMl` | `deleted` (soft) |
| `MonthlyBill` | `openingPaise`, `chargesPaise`, `paidPaise`, `closingPaise` | unique on `(milkman_id, customer_id, month)` |
| `Payment` | `amountPaise`, `balanceAfterPaise` | verified ledger entry, reversal fields, unique receipt |
| `PaymentIntent` | `amountPaise` | payee snapshot, internal reference, expiry, claim link; never proof of settlement |
| `Adjustment` | `amountPaise` | `type`, `status: applied\|reversed`, `reason`, reversal fields |
| `PaymentRequest` | `amountPaise` | pending/reconciliation/approved/rejected, canonical reference, intent/payment links |

---

## 14. Complete flows

### A. Dairy records a cash payment at the door

1. Dairy opens Payments → Monthly bills, finds the customer's row, reads
   **Closing due**.
2. Clicks Record payment, enters the rupee amount (UI caps it at the outstanding
   balance), picks `cash`, submits.
3. Frontend converts to paise via `decimalUnits`, mints an `Idempotency-Key`,
   sends `POST /payments`.
4. Server allocates to that bill, bumps `paidPaise`, reduces `closingPaise`,
   writes `Payment` with a `GA-…` receipt, logs the audit row.
5. Success notice shows the receipt number; it appears in the Receipts tab.

### B. Customer pays by UPI and the dairy verifies

1. Customer clicks **Pay now** on an outstanding bill and chooses an allowed
   partial or full amount.
2. The server creates an idempotent `PaymentIntent` and returns the exact payee,
   amount, UPI URI and QR.
3. Customer completes the transfer in a compatible UPI app, returns, and submits
   the bank/UPI reference. This creates a claim, not a payment.
4. Dairy receives a notification, opens the verification dialog, and compares
   customer, bill, amount and reference with the actual receiving account.
5. After checking the account, dairy staff attest settlement and approve. The
   server creates one payment and receipt transactionally and notifies the
   customer.
6. Changed balances become reconciliation exceptions. Rejection requires a
   reason and leaves the ledger untouched.

### C. Closing the month

1. Dairy clicks **Batch generate bills**.
2. The scheduler takes the distributed lock for that month, then for each active
   customer either refreshes an existing bill or creates a new one with the prior
   closing carried forward. Customers with no deliveries and no debt are skipped.
3. Summary shows generated / updated / skipped / errors.

### D. Correcting a mistake

- **Overcharge on a past bill** → Apply adjustment → `credit` with a reason. The
  oldest outstanding bill is reduced.
- **Payment that never happened** → Receipts → Reverse, with a reason. The debt
  returns.
- **Entry recorded on the wrong day** → the period is closed, so the correction
  route is an adjustment, not a record edit
  (`PERIOD_CLOSED`, `services.js:48`).

---

## 15. Deployment, limitations and future gateway migration

### Deployment requirements

- Configure each dairy's UPI ID through the validated vendor profile; never
  hardcode a real identifier.
- Run MongoDB as a replica set because intent creation, claims, approvals,
  reversals and audit entries depend on transactions.
- Keep `JWT_SECRET`, CORS origins and normal production TLS configuration
  private and correctly scoped.
- The backend generates QR PNG data with the installed `qrcode` package. No paid
  API key is required.
- Apply and verify schema indexes before serving traffic. Audit existing payment
  references before changing the legacy global, case-sensitive
  `Payment.reference` index; customer claims already use tenant-scoped
  canonical uniqueness.

### Known limitations

1. A QR or UPI deep link is not a provider-issued payment request and cannot
   prove settlement. Staff confirmation remains mandatory.
2. UPI app handling varies by browser, operating system and installed apps.
   Copying the UPI ID and amount is the supported fallback.
3. Intent expiry is informational. A customer may have paid before or after it,
   so claims remain reconciliation evidence.
4. There is no split allocation: one payment or claim targets one bill.
5. Orders remain outside the milk ledger unless represented by an adjustment.
6. Disputes are conversational and do not move money automatically.
7. Historical payments created before receipt snapshots have
   `balanceAfterPaise: null`; current bill balance is labelled separately.
8. Genuine overpayments or payments against a settled bill require authorized
   manual reconciliation; they are not silently forced into the ledger.

### Future gateway migration

A future regulated gateway can replace the initiation transport while preserving
`MonthlyBill → PaymentIntent → PaymentRequest → Payment`. Provider order IDs,
signed webhooks and settlement identifiers should attach to the intent/claim.
Webhook authenticity and idempotency must be verified before approval, and the
existing `Payment` ledger, receipt, reversal, audit and tenant rules should
remain the financial source of truth.

---

## 16. Where to look in the code

| Concern | File |
|---|---|
| Charge maths, `charge()` | `backend/src/domain.js` |
| Ledger writes: bill, payment, statement, idempotency | `backend/src/services.js` |
| UPI URI, intent persistence and QR generation | `backend/src/upi.js` |
| Reversals, adjustments, claim review routes | `backend/src/app.js:231-532` |
| Audited transaction helper `change()` | `backend/src/accounts.js:9` |
| Models and indexes | `backend/src/models.js` |
| Joi validation for every money payload | `backend/src/validation.js` |
| Batch billing + distributed lock | `backend/src/billing-scheduler.js` |
| Bill and report PDFs | `backend/src/pdf.js` |
| Dairy-side payments UI (4 tabs) | `frontend/src/features/vendor/Payments.jsx` |
| Customer-side bills, claims, receipts | `frontend/src/features/customer/Portal.jsx` |
| Paise ⇄ rupee conversion | `frontend/src/lib.js:9-20` |
| Native bill sharing | `frontend/src/share.js` |
