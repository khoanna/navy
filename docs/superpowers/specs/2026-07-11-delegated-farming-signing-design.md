# Delegated Farming Auto-Funding (Privy session keys) — Design

**Date:** 2026-07-11
**Status:** Design approved
**Scope:** Add end-to-end Privy **delegated signing (session keys)** so a user can enable "auto-farm": after delegating their embedded wallet, the backend automatically tops up their farming subwallet from their embedded wallet (bounded, server-validated). Spans `be/` + `expo-wallet/`. **No** changes to the audited subwallet custody model.

This is **sub-project B** of the Privy work; **sub-project A** (recovery, passkey-2FA, MFA-gated signing, on-ramp) is already implemented (`2026-07-11-expo-wallet-privy-feature-completion-design.md`).

## Background & decisions

Farming today (`be/src/farming`, `be/src/wallet`) uses a **Navy-generated subwallet** (fresh keypair, AES-256-GCM envelope-encrypted via `be/src/crypto`) signed by the isolated `SigningService` after a `PolicyValidator` check against per-subwallet allowlists (`deriveTxSummary` decodes the *actual* tx). This subwallet is **orthogonal** to the user's Privy embedded wallet, and the user must **manually move SOL into the subwallet** to farm.

Privy delegated signing lets the **backend sign on the user's own embedded wallet** (no per-tx prompt) after the user delegates it. Verified capability of the installed **`@privy-io/server-auth@1.32.5`**: `privyClient.walletApi.solana.signTransaction({ walletId | (address+chainType), transaction })` returns `{ signedTransaction }`; the `PrivyClient` accepts `walletApi.authorizationPrivateKey`; `getUser` returns linked wallet accounts whose `id` is populated and `delegated === true` when delegated. Client capability (installed `@privy-io/expo@0.70`): `useHeadlessDelegatedActions().delegateWallet({ address, chainType })` / `revokeWallets()`.

**User decisions:**
- **B-1 (auto-fund, complement)** — keep the audited subwallet model; use delegated signing *only* to move SOL from the user's embedded wallet → their own subwallet. (Not B-2, which would replace the subwallet and expose the user's primary wallet.)
- Automate: **auto-fund subwallet**, **auto-sweep withdrawals**, **one-tap start**.

**Key narrowing insight:** auto-sweep needs **no** delegated signing — withdrawals are already signed by the subwallet (`SigningService`) to `ownerMainWallet` (the user's embedded wallet). So the *only* delegated operation is **transfer: user embedded wallet → user's subwallet**. This is the entire delegated blast radius.

## Security model (authoritative)

1. **Off by default.** The whole feature is disabled unless `PRIVY_AUTHORIZATION_KEY` is configured (mirrors how MFA/on-ramp are dashboard-gated). No auth key → delegation endpoints return "unavailable", agent skips delegated funding.
2. **User-owned wallet, explicit delegation.** The embedded wallet stays user-owned; the user delegates via client `delegateWallet(...)` and can `revokeWallets()`.
3. **Single delegated operation, server-built + server-validated.** Delegated signing happens *only* inside `DelegatedFundingService`, *only* for a server-built `SystemProgram.transfer` from the user's embedded wallet to **their own subwallet's** pubkey, with an amount within `[NAVY_FARM_FUND_MIN, NAVY_FARM_FUND_MAX]` and leaving `NAVY_FARM_USER_RESERVE` in the user wallet. Before signing, a new `DelegatedPolicyValidator` runs `deriveTxSummary` on the built tx and rejects anything that is not exactly that (defense-in-depth even though the server built it).
4. **Gasless two-signer.** Relayer is `feePayer` and `partialSign`s; the delegated user signature only authorizes the transfer. Consistent with the payments relayer model.
5. **Idempotency.** `walletApi` calls pass an idempotency key (derived from subwallet id + a coarse time bucket) so a retry can't double-fund.
6. **Untouched crown jewels.** `SigningService`, `PolicyValidator`, envelope encryption, and the subwallet deposit/withdraw flow are unchanged.
7. **Audit.** Every delegated fund records `actor: user:${userId}`, `action: farming.delegated.fund` (and `.denied` on policy failure), like the subwallet audit trail.
8. **Secret hygiene.** The authorization key loads like other secrets (never logged).

## Architecture

### Backend (`be/`)

**Config (`be/src/config/config.service.ts`)**
- `privyAuthorizationKey: string | undefined` — from `PRIVY_AUTHORIZATION_KEY` (optional; presence = feature enabled).
- Funding bounds (lamports): `farmUserReserve` (`NAVY_FARM_USER_RESERVE`, default e.g. 5_000_000), `farmFundMin` (`NAVY_FARM_FUND_MIN`), `farmFundMax` (`NAVY_FARM_FUND_MAX`). Add to `.env.example`.

**PrivyService (`be/src/wallet/privy.service.ts`)** — extend (don't fork):
- Construct `PrivyClient(appId, appSecret, { walletApi: { authorizationPrivateKey } })` when the key is present (else current behavior).
- `getDelegatedWallet(privyDid): Promise<{ walletId?: string; address: string } | null>` — `getUser`, find the linked solana wallet with `delegated === true`; return its `id` (walletId) and `address`. Null if none.
- `signDelegatedTransaction({ walletId, address, tx }): Promise<Transaction>` — call `walletApi.solana.signTransaction({ walletId ?? {address, chainType:'solana'}, transaction: tx, idempotencyKey })`; normalize the returned `signedTransaction` to a legacy `Transaction` (same defensive pattern used elsewhere). Throws if the auth key isn't configured.

**Prisma (`be/prisma/schema.prisma`)** — add to `User`:
- `farmDelegationWalletId String?`
- `farmDelegationEnabledAt DateTime?`
Revoke sets both null. (Migration via `pnpm prisma migrate dev`.)

**DelegatedPolicyValidator (`be/src/wallet/delegated-policy.validator.ts`)** — new, small, unit-tested:
- `check(tx: TxSummary, ctx: { subwallet: string; minLamports: bigint; maxLamports: bigint }): PolicyResult`
- Rules: exactly the instructions of a wrapped-SOL-free plain transfer — every instruction must be `system-transfer` (System Program) whose `destination === ctx.subwallet`; the transfer lamports must be within `[min, max]`; deny any other program/kind/destination. Reuse `TxSummary`/`deriveTxSummary` and the `PolicyResult` shape from the existing validator module.

**DelegatedFundingService (`be/src/farming/delegated-funding.service.ts`)** — new:
- `fundSubwalletFromUser(args: { userId, privyDid, walletId?, userAddress, subwalletPubkey, amountLamports }): Promise<{ txSignature: string }>`
  1. Build `SystemProgram.transfer({ fromPubkey: userAddress, toPubkey: subwalletPubkey, lamports: amountLamports })` into a `Transaction`; set `feePayer = relayer`, recent blockhash.
  2. `deriveTxSummary(tx)` → `DelegatedPolicyValidator.check(...)`; on deny → audit `.denied`, throw `ForbiddenException`.
  3. `relayer.partialSign(tx)`; `privy.signDelegatedTransaction({ walletId, address: userAddress, tx })`.
  4. Submit (`connection.sendRawTransaction` + confirm), audit `farming.delegated.fund`, return signature.
- `computeFundAmount(userBalance, subwalletIdle, bounds): bigint | null` — pure helper (unit-tested): `spare = userBalance - reserve`; if `spare < fundMin` → null; else `min(spare, fundMax)`. Keep this pure so it's testable without chain.

**Farming agent (`be/src/farming/farming-agent.scheduler.ts`)** — extend `tickOnce`:
- For each active subwallet whose user has `farmDelegationEnabledAt` set: if subwallet idle `< bounds.minDeposit`, read the user's embedded-wallet balance, `computeFundAmount(...)`; if non-null, `DelegatedFundingService.fundSubwalletFromUser(...)`. Wrap in try/catch → audit `farming.delegated.skip` on error (never break the tick). The existing auto-deposit then farms the topped-up idle on this or the next tick.

**Farming controller/service (`be/src/farming/*.controller.ts` / `farming.service.ts`)** — new endpoints (all `@Roles('user')`, JWT → Navy userId + privyDid):
- `POST /farming/delegation` — `getDelegatedWallet(privyDid)`; if none → 400 "wallet not delegated"; else store `farmDelegationWalletId` + `farmDelegationEnabledAt`, return status. (Feature-gated: 503 if no auth key.)
- `DELETE /farming/delegation` — clear both fields; return status. (Client also calls Privy `revokeWallets()`.)
- `GET /farming/delegation` — `{ enabled: boolean, available: boolean }` (`available` = auth key configured).
- `POST /farming/fund-now` — ensure delegation enabled; ensure/`createSubwallet` if needed; `computeFundAmount` from live balances; `fundSubwalletFromUser`; return `{ txSignature }` or `{ skipped: reason }`.

### Client (`expo-wallet/`)

**`src/lib/api/` (navyApi equivalent)** — add `getDelegation()`, `enableDelegation()`, `disableDelegation()`, `fundNow()` calling the endpoints with the Navy session bearer. Keep pure request/response mapping in a tested plain-TS module; a small `delegationStatus.ts` helper maps `{enabled, available}` → UI state (`'unavailable' | 'off' | 'on'`) — unit-tested.

**`src/features/farming/AutoFarmToggle.tsx`** — a toggle row on the Earn screen (`app/(tabs)/farming.tsx`):
- Reads `useHeadlessDelegatedActions()` (`delegateWallet`, `revokeWallets`) + `useMobileSigner()` (address).
- Enable: `delegateWallet({ address, chainType: 'solana' })` → `enableDelegation()` → `fundNow()`; toast the result.
- Disable: `disableDelegation()` → `revokeWallets()`.
- Hidden/disabled when status is `'unavailable'` (backend auth key not configured). Follows the restrained list UI language (IconBadge, caption eyebrow, `danger` for the off action).

## Data flow

Toggle ON → client `delegateWallet` → `POST /farming/delegation` (backend `getUser` → walletId, store, enable) → `POST /farming/fund-now` (one-tap). Agent tick: enabled user + subwallet idle < minDeposit → `computeFundAmount` → `fundSubwalletFromUser` (relayer fee-payer, delegated user sig, `DelegatedPolicyValidator`-checked) → existing deposit flow farms it. Withdraw/auto-sweep: unchanged (subwallet → user embedded wallet).

## Error handling

- Feature-off (no auth key): endpoints return 503/`available:false`; agent skips; client hides the toggle.
- Not delegated yet: `POST /farming/delegation` → 400; client surfaces "delegation cancelled/failed".
- Policy deny (should be impossible for server-built tx, but enforced): audit `.denied`, `ForbiddenException`, agent logs skip.
- Insufficient spare balance: `computeFundAmount` → null → fund-now returns `{ skipped }`, agent no-ops.
- Delegated-sign failure / user revoked on Privy side: caught, audited, agent continues; client status refresh reflects it.
- All chain submits reuse the existing submit/confirm + audit pattern.

## Config prerequisites (operator)

- Register an **authorization keypair** in the Privy dashboard and enable **delegated actions** for the app; set `PRIVY_AUTHORIZATION_KEY` (private key) in `be/.env`.
- These are the only new operator steps; devnet-only, no mainnet work.

## Testing & gates

- **Backend unit (jest, run SCOPED — the full suite loads the heavy web3 graph):**
  - `delegated-policy.validator.spec.ts` — allow bounded transfer to the subwallet; deny wrong program, wrong destination, over-max, under-min, extra instruction.
  - `delegated-funding.service.spec.ts` — builds the correct transfer, runs the policy check, calls `PrivyService.signDelegatedTransaction` with the walletId + idempotency, relayer co-signs, submits, audits; denies/`throws` when policy fails (mocks for PrivyService/relayer/connection/prisma).
  - `computeFundAmount` cases (reserve, min, max clamping, null).
  - config getter gate; agent tick includes delegated users (extend `farming-agent.scheduler.spec.ts`).
- **Client:** `delegationStatus.ts` + navyApi delegation functions unit-tested; `AutoFarmToggle`/screen tsc-gated.
- **Typecheck gates:** `be/ pnpm build` (nest build typechecks) and `expo-wallet/ pnpm exec tsc --noEmit`.
- **Live/E2E (operator-gated):** an optional `NAVY_FARM_E2E` extension can exercise fund-now against devnet, but a real delegated-signing flow requires the dashboard authorization keypair + a delegated wallet + live devnet; documented as a manual runbook step, not an automated gate.

## Out of scope

- B-2 (replacing the subwallet) — rejected.
- Delegated signing for anything other than user→own-subwallet funding (no delegated payments, no delegated Save calls).
- Mainnet KMS for the authorization key (deferred like the subwallet master key).
- Privy dashboard policy-engine configuration (we enforce server-side via `DelegatedPolicyValidator`).
