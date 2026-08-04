# Platform Admin production rollout runbook

**Status:** Phase 5 preparation only. This document is the operator checklist.  
**Do not** apply migrations, deploy, wipe, or bootstrap against production from agent workflows.

Objective: reverse calmly at 2 AM without archaeological digs.

---

## A. Scope and exact release commits

Fill in after Phase 5 push (placeholders until commit hashes are known):

| Component | Branch | Commit |
|-----------|--------|--------|
| Backend (`opsflow-erp-backend`) | `v3/main` | `a5217c2` (Phase 5 tip; Phase 1–4: `d13a720`…`9618375`) |
| Web (`opsflow-erp-web-v2`) | `v3/main` | `f36de05` (Phase 5 tip; Phase 1–4: `f424153`…`a5916d9`) |
| Driver mobile | `main` | `84a1102` (unchanged) |
| Warehouse mobile | `main` | `8b1e0a0` (unchanged) |

**Migration:** `20260804200000_platform_admin_phase1` (additive; unapplied until operator runs migrate deploy).

**Included:** PlatformAdmin identity, tenant lifecycle/modules, `/control` UI, tenant enter/exit (no synthetic membership), tenant-user provisioning, operational ADMIN-class PA access, module entitlements, destructive confirms, audit coupling for Prisma control-plane mutations, customer document FINANCE strip, quotation TRANSPORT gate, 403 session preservation.

**Excluded:** CUSTOMER impersonation, mobile Platform Admin, GPS changes, wipe, EAS/store/OTA, production migrate/deploy from this phase.

---

## B. Required environment / configuration

### Backend
- `DATABASE_URL` (never paste into tickets/logs)
- `SUPABASE_PROJECT_URL` / `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- JWT / auth secrets already used by AuthGuard
- Allowed CORS origins for web
- `X-Tenant-Id` header accepted on operational routes

### Supabase
- Existing Auth users for Platform Admin bootstrap email
- Storage buckets unchanged (`job-documents`, `invoice-documents`, …)

### Bootstrap inputs
- Existing User email (already in Auth + `users` table)
- Explicit `--confirm` (and `--reactivate` only if DISABLED)

### Audit / logging
- PlatformAuditLog append-only
- Never log passwords, JWTs, refresh tokens, signed URLs, service role keys

---

## C. Preflight

- [ ] Confirm currently deployed backend/web revisions
- [ ] Confirm `v3/main` tips match release commits above
- [ ] Confirm backup / PITR status and retention window
- [ ] Verify migration history; confirm `20260804200000_platform_admin_phase1` not yet applied (or already applied in staging only)
- [ ] Schema drift check against staging, not production write
- [ ] No active P1 incident
- [ ] GPS services explicitly **out of scope**
- [ ] Error/audit dashboards ready
- [ ] Maintenance window + operator named
- [ ] Rollback owner + stop/go authority named

---

## D. Recommended deployment order

Rationale: migration is additive; old app can coexist briefly with new tables; new backend expects schema; web must not expose `/control` flows before backend is healthy.

1. Announce maintenance / change window.  
2. Confirm backup/PITR and preflight gates.  
3. **Apply** `20260804200000_platform_admin_phase1` (operator only).  
4. Verify migration/schema only (enums, tables, backfill count for SUPERADMIN → platform_admins).  
5. Deploy **backend**.  
6. Backend health + ordinary tenant smoke (login, jobs list, warehouse, invoices as applicable).  
7. Bootstrap / verify first Platform Admin (section E).  
8. Deploy **web**.  
9. Platform Admin + tenant-operation smoke (section F).  
10. Monitor (section G).  

Do **not** deploy mobile unless a Phase 5 compatibility fix was pushed.

Mixed-version window: additive schema should tolerate old backend reads; avoid enabling new PA UI until backend deploy succeeds.

---

## E. First Platform Admin bootstrap

Script: `scripts/provision-platform-admin.ts`

```text
dotenv -e .env.<env> -- npx ts-node --project tsconfig.seed.json \
  scripts/provision-platform-admin.ts --email=<existing-user-email> --confirm
```

- `--dry-run` first when unsure  
- `--reactivate` only to flip DISABLED → ACTIVE  
- Creates `PlatformAdmin` ACTIVE; may set `User.role=SUPERADMIN` legacy bridge  
- **Does not** create TenantMembership  
- Does not print passwords  
- Verify: authenticated `GET /platform/me` returns ACTIVE Platform Admin  
- Kill switch: set PlatformAdmin status DISABLED via platform admins API or DB update (prefer API)

**Do not execute against production during Phase 5 verification.**

---

## F. Smoke-test matrix

### Ordinary users
- ADMIN / TRANSPORT_STAFF / WAREHOUSE / FINANCE / CUSTOMER (if used) / DRIVER mobile  
- Tenants: ACTIVE, SETUP, SUSPENDED (blocked), ARCHIVED (rejected)  
- Module combos: TRANSPORT / WAREHOUSING / FINANCE on/off  

### Platform Admin
- `/control` access; list/view tenants; provision user; enter tenant; banner; nav; read; safe mutation; destructive confirm+reason; audit row; exit; cross-tenant reject; disabled-module reject; no synthetic membership  

### Documents
- Upload/download/signed URL in correct tenant  
- Cross-tenant ID rejected; arbitrary storage key rejected  
- Customer docs: invoice PDFs absent when FINANCE disabled  

### Mobile
- Driver login + current trip read  
- Warehouse username login + assigned job  
- No Platform Admin mode  

### GPS
- Health only if already in monitoring — no mutation paths  

---

## G. Observability

Watch for: `TENANT_*` / `PLATFORM_TENANT_*` audit events; Supabase Auth failures; 401/403 rate changes; 5xx and `PLATFORM_AUDIT_RECONCILIATION_REQUIRED`; migration errors; tenant-selection failures; cross-tenant rejections; document signing failures; latency.

Ownership: on-call for monitoring window (suggest ≥ 2 hours post web deploy).

---

## H. Rollback gates (stop immediately)

- Migration failure  
- Backend cannot serve ordinary users  
- Login/auth regression  
- Cross-tenant exposure  
- Incorrect module authorization  
- Audit failure storm on sensitive actions  
- Mobile workflow regression  
- Unexplained elevated 401/403/5xx  
- Lifecycle / data-integrity regression  

---

## I. Rollback procedure

Prefer:

1. **Disable Platform Admin** accounts (kill switch).  
2. **Roll back web** to prior commit (hides `/control`).  
3. **Roll back backend** to prior commit if ordinary users broken.  
4. **Leave additive schema in place** — do not drop `platform_admins` / `platform_audit_logs` / entitlements during an incident.  
5. Reverse schema only if proven necessary and safe; preserve audit evidence.  

Old application versions: additive columns/tables should be ignored by old code paths; verify against staging before claiming.

Verify after rollback: ordinary login, job list, warehouse, invoices, no `/control` for non-PA.

---

## J. Go / no-go checklist

- [ ] Preflight complete  
- [ ] Backup/PITR confirmed  
- [ ] Migration static review signed off  
- [ ] Backend tests/build green on release commit  
- [ ] Web tests/build green on release commit  
- [ ] Mobile compatibility verified (unchanged or fix pushed)  
- [ ] Bootstrap procedure dry-runned on non-prod  
- [ ] Rollback owner online  
- [ ] GPS out of scope confirmed  
- [ ] Operator authority grants go  

**Phase 5 recommendation:** see final report §21 — prepare go, do not execute until operator fills commits and staging migrate succeeds.

---

## Audit atomicity notes (honest)

### Transactional (same Prisma DB)
- Platform control-plane: tenant create/update/suspend/reactivate/setModules via `$transaction` + `appendInTx`

### Post-commit interceptor (ambiguous if audit fails)
- `@DestructiveAction` operational routes under PA tenant operation (job cancel/delete, invoice issue/revert, warehouse cancel, admin password reset/remove, …)  
- On audit failure → HTTP 503 `PLATFORM_AUDIT_RECONCILIATION_REQUIRED`  
- Clients must refresh/reconcile; no blind retry  

### External side effects (cannot join Prisma tx)
- Supabase Auth user create / password reset  
- Storage upload then DB row  

**Order (typical provisioning):** Auth create → Prisma user+membership tx → PlatformAuditLog best-effort/failure audit.  
**Compensation:** delete Auth user if Prisma fails (existing provisioning paths).  
**Never claim rollback** if Auth/storage already succeeded — return reconciliation error.

---

## Invoice reason decision

- **Issue / save under company:** high-risk confirm; **reason not required** unless a future compliance rule says otherwise. Still audited for PA.  
- **Revert / void / cancel / destructive rollback:** **reason required**.
