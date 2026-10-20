# Implementation status and next milestones

See [VERIFICATION.md](VERIFICATION.md) for baseline checks and verified implementation findings.

The source SRS describes the target product. Its embedded workflow and approval language is treated as document content; it does not independently authorize publishing, contacting people, or configuring external accounts. No external deployment or outbound customer communication has been performed during development.

## Current implementation — vendor core and customer onboarding

| SRS area | Current status | Remaining acceptance work |
| --- | --- | --- |
| Authentication | Milkman/customer OTP registration; explicit verified-email history claim; JWT login and logout revocation; OTP expiry/replacement/attempt tests | Password recovery, refresh/session persistence, further abuse and outage tests |
| Accounts | Audited customer creation/edit/lifecycle; rates and four quantity defaults; self-service name/address/language edits; linking-code regeneration | Vendor business-profile editing, validated route reorder, subscription fields, phone/email change verification |
| Deliveries | Transactional batch create, exact snapshots, duplicate prevention; per-customer milk selection and prefilled shift defaults with daily overrides | Corrections/soft deletion and audit diff, adjustment cutoff/overlap rules, fat/SNF, complete history filters |
| Offline | IndexedDB queue; reconnect retry, immediate view refresh, authentication retry and conflict display | Persistent route cache, editable conflicts, multi-tab UX, cold-start flow, robust navigation guards |
| Billing | Completed-month reproducible bills; chronological generation | Carry-forward ledger, adjustments, formal credit/refund/reversal model, automatic monthly scheduling |
| Payments | Cash/UPI/bank recording; bounded allocation; immutable unique receipt identifiers | Customer claims/review, receipt documents, reconciliation/provider integration, reasoned reversals |
| Reports | Tenant/customer-scoped bounded delivery CSV | PDF and other report families, asynchronous export jobs, report-level summaries |
| UI | Responsive vendor/customer pages, role-specific routes, verified onboarding, explicit demo, short-screen sidebar fix | Hindi/Gujarati, complete accessibility audit, complete admin operations, loading/error refinements |
| Production | Environment validation, health, graceful shutdown, hosting/CI templates | MongoDB collection validators, telemetry, alerts, backups/restore, load/chaos tests, deployed authorization tests |

## Milestone 2 — complete delivery and onboarding journeys

1. **Implemented:** customer registration by code, email verification, explicit secure history claim, read-only ledger portal, and customer name/address/language editing. Customer payment claims, adjustments, products and disputes are still pending.
2. **Implemented:** customer rates/defaults/details editing, lifecycle audit, link-code regeneration, validated route reordering, and vendor business-profile editing.
3. **Implemented:** audited delivery corrections and soft deletion with transaction-level period locking and audit log diffs.
4. **Implemented:** durable offline route caching (v2 IndexedDB cache), interactive conflict resolution with per-item editing and selective removal, multi-tab BroadcastChannel synchronization, robust browser popstate navigation protection, and verified Playwright reconnect scenarios.
5. **Implemented:** i18next translations for English, Hindi, Gujarati; dynamic `<html lang="...">` switching; contrast compliance (WCAG 2.1 AA token `--muted: #57655c`), screen-reader label compliance, and 320px viewport responsive safeguards. Milestone 2 is complete.


## Milestone 3 — full financial workflow and commerce

1. **Implemented:** Opening-balance accounting, carry-forward ledger allocation (unpaid debt rollover), automated monthly billing scheduler with MongoDB distributed locking, customer self-service payment claims, vendor approval/rejection workflows with audit trails, and immutable digital receipts.
2. **Implemented:** Approved credit/refund/reversal model; permissioned, reasoned audit entries with before/after diffs; soft payment reversal with atomic bill balance restoration; credit, debit, waiver, and refund ledger adjustments with bounds checks and reversal support.
3. **Implemented:** Product catalogue with tenant scoping and soft-deletion; permanent price-snapshot order creation; strict state machine transitions (placed -> confirmed -> fulfilled / cancelled) with mandatory cancellation reasons; customer disputes lifecycle with threaded replies, auto-review progression, and reasoned resolution.
4. Shared report calculations for UI/CSV/PDF and durable large-export jobs.

## Milestone 4 — platform operations and production acceptance

1. Named admin permissions, last-super-admin safeguard, settings encryption/versioning, operational dashboards, activity log.
2. Tenant/user-scoped Socket.IO; durable email/WhatsApp outboxes with deduplication and retries.
3. Collection validators and index migrations, backup/restore rehearsals, metrics, tracing, outage tests, load baseline.
4. Preview/staging deployments, CI merge gates, rollback rehearsal, deployed tenant and retry tests, then production launch.

## Product decisions preserved

Business names are display-only, customer switching is not exposed, INR operational billing has no tax claim, overpayment is rejected, and subscription enforcement is absent. Retention, provider selection, formal credits/refunds, adjustment cutoff, dispute SLA, tax treatment, plan pricing, and operational targets need product decisions before their dependent workflows ship.

## Admin console increment

Implemented local super-admin bootstrap, admin JWT login, named read permissions, dashboard counts, paginated user/dairy directories and activity log. Admins cannot use tenant endpoints as an ownership bypass; customers and vendors cannot access admin endpoints. The console is currently read-only. Account lifecycle actions, access-control editing and last-super-admin safeguards for those future mutations, financial admin workflows, settings and backup operations remain pending.
