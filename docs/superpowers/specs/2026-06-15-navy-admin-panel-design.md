# Navy — Admin Panel (Merchant Approval) Design Spec

**Date:** 2026-06-15
**Status:** Approved (design)
**Sub-project:** 4 of N in the Navy ecosystem (admin panel)

---

## 0. Context

Navy's foundation (admin auth: password+TOTP, admin-role JWT; Next.js admin shell with `/admin` gated by role), the `navy_payments` program (deployed devnet; `register_merchant` + `set_merchant_active`, admin-gated), and the payment gateway are built. This sub-project adds the **merchant approval workflow**: an admin reviews pending merchants and approves/rejects them, and approval **registers the merchant on-chain** so they can receive payments.

### Decisions locked during brainstorming
- **Auto on-chain registration via a dedicated registrar key.** Approval auto-calls `register_merchant` using a `RegistrarService` whose keypair (`NAVY_ADMIN_SECRET`) IS the program's admin authority — **separate from the relayer**.
- **Require `payoutAddress` before approval** (the on-chain payout ATA derives from it).
- **Scope = backend approval API + fe admin pages.**
- **Approve is atomic with registration:** register on-chain first; only on success set `approvalStatus='approved'`. A failure leaves the merchant `pending` (retry) — no "approved-but-unregistered" limbo.
- Devnet only.

---

## 1. Scope & boundaries

**In scope:**
- Backend `AdminMerchantsModule`: list/detail/approve/reject endpoints (admin-role).
- `RegistrarService`: on-chain `register_merchant` / `set_merchant_active` using the registrar (admin-authority) keypair, with register-or-reactivate logic.
- Merchant schema additions for on-chain registration tracking + rejection reason.
- fe admin pages: merchant list (status filter), detail, approve/reject; Next route handlers proxying the backend with the admin session cookie.
- Audit logging of approve/reject/register.

**Out of scope (later/other):**
- Merchant dashboard (sub-project 5), mobile wallet (6), farming (7).
- Admin management of fee/treasury/config (the registrar key *can* do it, but no UI here).
- Mainnet registrar hardening (multisig / limited registrar role) — documented, not built.
- New program instructions (uses existing `register_merchant`/`set_merchant_active`).

---

## 2. Backend — schema + approval API

Merchant schema additions (`be/prisma/schema.prisma`):
```
onchainRegisteredAt  DateTime?
onchainRegisterTx    String?
rejectionReason      String?
```
(`approvalStatus pending|approved|rejected` and `payoutAddress` already exist.)

`AdminMerchantsModule` — all endpoints behind `JwtGuard + RolesGuard` `@Roles('admin')`:
- `GET /admin/merchants?status=pending|approved|rejected|all&take=&skip=` — paginated list (id, email, businessName, approvalStatus, payoutAddress, onchainRegisteredAt).
- `GET /admin/merchants/:id` — full detail incl. `onchainRegisterTx`.
- `POST /admin/merchants/:id/approve` — preconditions: merchant exists, `payoutAddress` set, not already `approved`+active. Calls `RegistrarService.ensureRegisteredActive` (§3); on success sets `approvalStatus='approved'`, `onchainRegisteredAt`, `onchainRegisterTx`; audits. Idempotent.
- `POST /admin/merchants/:id/reject` — body `{ reason? }`. Sets `approvalStatus='rejected'`, `rejectionReason`; if the merchant was registered on-chain, calls `set_merchant_active(false)`; audits.

---

## 3. RegistrarService + key security

`RegistrarService` (in the onchain area, reusing the `NAVY_ONCHAIN` program + `payments-client` PDAs) holds the **registrar keypair** from env `NAVY_ADMIN_SECRET` — the program's **admin authority**, distinct from the relayer.

Derivation (matches the gateway's `RelayerService` exactly, so registry and payment agree):
- `merchantAuthority = new PublicKey(merchant.payoutAddress)`
- `payout = getAssociatedTokenAddress(USDC_MINT, merchantAuthority)`

`ensureRegisteredActive(merchant): Promise<string>` (returns tx signature):
1. Fetch the on-chain `Merchant` PDA (`merchantPda(programId, merchantAuthority)`).
2. If it **does not exist** → `register_merchant(payout)` signed by the registrar.
3. If it **exists** → `set_merchant_active(true)` signed by the registrar (covers re-approval after a reject, since `register_merchant` can only run once per merchant — its PDA is `init`).

`deactivate(merchant)` → `set_merchant_active(false)` (used on reject when registered).

**Security:** `NAVY_ADMIN_SECRET` is the on-chain admin authority (can change fee/treasury and register/deactivate any merchant) — a hot key in backend env. **Devnet-acceptable; mainnet must harden** (separate limited registrar role via a program change, or a multisig admin). Registrar actions are audited.

---

## 4. Approval flow (atomic with on-chain)

```
admin clicks Approve
  └─ precondition: payoutAddress present, not already approved+active  → else 409
  └─ RegistrarService.ensureRegisteredActive(merchant)   (register OR reactivate)
        success → set approvalStatus='approved', onchainRegisteredAt, onchainRegisterTx; audit; return merchant
        failure → 502, merchant stays 'pending' (admin retries)   // no limbo state
admin clicks Reject
  └─ set approvalStatus='rejected', rejectionReason
  └─ if onchainRegisteredAt set → RegistrarService.deactivate(merchant)
  └─ audit
```

States: `pending → approved` (on-chain active) / `pending → rejected`; `rejected → approved` (reactivate); `approved → rejected` (deactivate).

---

## 5. fe admin pages + route handlers

- `/admin/merchants` (server component) — table of merchants with a status filter (`pending` default); each row links to detail. Reads via `/api/admin/merchants`.
- `/admin/merchants/[id]` — detail: business name, email, payout address, approval status, on-chain register tx (link to explorer), rejection reason. **Approve** + **Reject** buttons (client component). Approve is **disabled with a hint** when `payoutAddress` is missing.
- Next route handlers (proxy the backend with the admin session cookie's Bearer, reusing the foundation web's `ACCESS_COOKIE`/session pattern):
  - `GET /api/admin/merchants` (forwards query), `GET /api/admin/merchants/[id]`, `POST /api/admin/merchants/[id]/approve`, `POST /api/admin/merchants/[id]/reject`.
- The admin dashboard (`/admin`) links to `/admin/merchants`. Middleware already gates `/admin/**` by the `admin` role.

---

## 6. Error handling & edge cases

- Approve without `payoutAddress` → `409` (and the UI disables the button).
- Merchant not found → `404`.
- On-chain register/reactivate failure (RPC down, registrar out of SOL) → `502`; merchant stays `pending`; surfaced to the admin to retry.
- On-chain `Merchant` PDA already exists → reactivate path (success, not an error).
- Reject of an unregistered merchant → DB-only (no on-chain call).
- Double-approve / approve an already-active merchant → idempotent (reactivate is a safe no-op).
- Non-admin caller → `403` (RolesGuard).
- Invalid `payoutAddress` (not a valid pubkey) → `400` at approve time (caught when constructing the PublicKey).

---

## 7. Testing strategy

- **Unit (be):** approve precondition (payout required → 409); approve happy path sets status + stores tx (RegistrarService mocked); reject sets status + reason + deactivate-if-registered; RegistrarService `ensureRegisteredActive` register-vs-reactivate decision (mocked program account fetch + connection); audit calls; list/detail filtering.
- **Integration (be, localnet mirroring the onchain harness):** approve a payout-set merchant → assert the on-chain `Merchant` PDA exists and `active=true`; reject → `active=false`; re-approve → `active=true` again.
- **fe:** route-handler auth proxy (cookie → Bearer) unit test; manual smoke for the list/detail/approve/reject pages against the running backend.

---

## 8. Deferred / future

- Mainnet registrar hardening (multisig admin or a dedicated registrar role added to `navy_payments`).
- Merchant-facing notification on approval/rejection (email/webhook).
- Bulk approve, search/sort, audit-log viewer in the admin UI.
- Admin management of fee/treasury via UI.
