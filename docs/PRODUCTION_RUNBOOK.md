# GauAmrut production runbook

This runbook is the release gate for public production. Repository automation is implemented; account-owner actions remain checkboxes because source code cannot create or authorize third-party accounts.

## 1. Infrastructure and secrets

- [ ] Create MongoDB Atlas replica-set deployment, least-privilege application user, IP/network rules, point-in-time backups, and a separate restore-test project.
- [ ] Create managed Redis with TLS, authentication, eviction disabled for rate-limit correctness, and provider alerts.
- [ ] Create production SMTP credentials and verify the sending domain (SPF, DKIM and DMARC).
- [ ] Generate separate random values for `JWT_SECRET` and `METRICS_TOKEN` (at least 32 characters each).
- [ ] Set `CORS_ORIGINS` to exact HTTPS frontend origins only.
- [ ] Set frontend `VITE_API_URL` to the HTTPS backend URL ending in `/api`.
- [ ] Configure production domain, DNS, HTTPS redirects and certificate renewal.
- [ ] Never commit `.env`; use Render/Vercel secret stores.

## 2. Database release procedure

1. Take an Atlas snapshot and record its restore point.
2. Run `npm --prefix backend run migrate:check` against a production-like copy.
3. Resolve every reported tenant/reference collision. Never delete financial rows merely to make migration pass.
4. Run `npm --prefix backend run migrate` during a maintenance window.
5. Deploy the application. Production startup refuses to serve with pending or modified migrations and never creates indexes automatically.
6. Confirm health and a tenant-scoped payment smoke test.

Migration `001-payment-reference-scope` canonicalizes payment references, blocks on same-tenant case-insensitive collisions, removes the legacy global index, and creates `{ milkman_id, referenceCanonical }` uniqueness.

## 3. Backup, restore and rollback

- Atlas automated snapshots are the primary backup. `npm --prefix backend run backup -- <directory>` creates an additional encrypted-at-rest archive when MongoDB Database Tools are installed and writes a SHA-256 manifest.
- Quarterly, restore the newest backup to the isolated restore environment with `npm --prefix backend run restore -- <archive> --confirm`; verify counts, tenant isolation, login, invoices and payment reports.
- Keep the previous Render deploy available. Application rollback uses the provider rollback; database rollback restores the pre-migration snapshot. Never run an old binary against a forward-only schema without checking migration compatibility.
- Record operator, timestamp, snapshot/archive identifier, checksum, duration and verification result for every rehearsal.

## 4. Monitoring and alerting

- `/api/health` must be checked every minute from outside the hosting provider. Alert after two failures.
- `/api/metrics` is Prometheus text protected by `Authorization: Bearer $METRICS_TOKEN`. Monitor request volume, 5xx responses, latency, billing runs and billing failures.
- Ship JSON stdout/stderr logs to centralized storage. Alert on `request_failed`, `redis_error`, `monthly_billing_cron_failed`, repeated OTP delivery failures and reconciliation exceptions.
- Provider alerts: CPU/memory saturation, restart loops, Redis availability, Atlas connections/storage/replication lag, SMTP rejection rate and certificate expiry.
- Keep request IDs in support tickets; never log passwords, OTP values, tokens, UPI PINs or full connection strings.

## 5. Staging acceptance

Run `STAGING_API_URL=https://.../api npm run staging:smoke`, then complete and record:

- [ ] Real SMTP registration, OTP expiry/attempt limits and account recovery
- [ ] Milkman/customer/admin authorization and cross-tenant denial
- [ ] Customer create/link/edit/deactivate/reactivate
- [ ] Online and offline delivery sync; monthly billing and cron execution
- [ ] Invoice PDF with long tables, Unicode and emoji
- [ ] UPI QR scan and handoff on Android with Google Pay, PhonePe and one other installed UPI app
- [ ] Manual claim approval, rejection, duplicate reference and concurrent approval
- [ ] Redis restart/outage, Mongo failover, CORS denial and rate limiting
- [ ] Backup restore rehearsal and application rollback

UPI settlement must be checked in the dairy's real UPI/bank account. GauAmrut records and reconciles evidence; it does not process or guarantee settlement.

## 6. Release governance

- Require the GitHub `validate` job, reviewed pull requests and a protected production branch.
- CI runs lint, backend/frontend tests, production build, contrast audit, browser journeys and dependency audits.
- Run the workflow-dispatch staging smoke job after deployment; configure repository variable `STAGING_API_URL`.
- Review the public privacy, terms, retention/deletion, support and payment wording with qualified Indian counsel before accepting public registrations.

## 7. Incident procedure

1. Triage severity and preserve request IDs/logs.
2. Contain: suspend affected users, revoke sessions, rotate exposed secrets and pause deployment/cron if necessary.
3. Recover from a known-good deploy or verified backup.
4. Validate tenant isolation, ledger totals and authentication before reopening.
5. Notify affected users and authorities when required; document timeline, impact, root cause and corrective actions.

## External actions that cannot be completed in source control

Atlas/Redis/SMTP account creation, DNS/certificates, secret entry, branch-protection switches, provider alert destinations, real-device UPI tests, legal approval and live restore/rollback rehearsals require the authorized account owner. Do not mark the public-release gate complete until evidence for each item is attached to the release record.
