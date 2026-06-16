# Navy — Farming Agent Design Spec

**Date:** 2026-06-16
**Status:** Approved (design)
**Sub-project:** 7 of 7 in the Navy ecosystem (farming agent — the headline feature)

---

## 0. Context

The Navy foundation already built the **subwallet security plumbing** (sub-project 1 backend): `farming_subwallets` (Navy-generated keypair, AES-256-GCM envelope-encrypted private key behind a `Cipher` interface with an env-var master key, `policyJson`, `status`), `SubwalletService.provision` (generate keypair, seal, store), an isolated `SigningService` (decrypt the key transiently in memory → enforce a pre-sign `PolicyValidator` → sign → wipe), and a `PolicyValidator` (program ids derived authoritatively from the tx; **transfer destinations currently caller-provided = a flagged SECURITY TODO**).

This sub-project builds the actual farming feature on top: a user creates a farming subwallet, funds it with SOL, and a **backend agent** deposits the SOL into a real DeFi lending pool to earn yield (auto-compounding), the user can withdraw back to their main wallet — and it **closes the PolicyValidator SECURITY TODO**, which is what makes a real-protocol integration safe.

### Decisions locked during brainstorming (with deep-research backing)
- **DeFi target = Save (Solend) lending, farming the SOL reserve on devnet.** Deep research (102 agents, 25 claims verified, on-chain RPC checks, June 2026) found real DeFi is mainnet-first; Save is the only option with **concrete documented + on-chain-verified devnet addresses** and a SOL reserve. Farming **SOL** (freely airdroppable on devnet) sidesteps the verified gotcha that *no protocol's devnet pool uses Circle USDC* (each uses a custom minted token).
- **Internal `YieldAdapter` boundary** — `SaveYieldAdapter` (devnet) now; `KaminoYieldAdapter` is the documented mainnet target, drop-in via the same interface.
- **Harden `PolicyValidator`** to derive transfer destinations authoritatively from the tx (program allowlist + destination allowlist) — closes the SECURITY TODO.
- **Devnet auto-compounds via the cToken exchange rate** (Save has no devnet liquidity mining per its docs); the reward harvest/compound cron is a mainnet feature.
- **Combined spec** (backend/on-chain agent core + mobile UI) per user choice.
- Devnet only; env-var master key is an accepted devnet risk (KMS before mainnet).

### Verified Save devnet addresses (from research, on-chain confirmed)
- Program: `ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx`
- Lending market: `GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp`
- **SOL reserve: `5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz`**
- (USDC reserve `FNNkz4RCQezSSS71rW2tvqZH1LCkTzaiG7Nd1LeA5x5y` — for the mainnet/USDC path.)
- SDK: `@solendprotocol/solend-sdk` (ships from `solendprotocol/public`; the standalone repo is archived but npm is current).

---

## 1. Scope & boundaries

**In scope:**
- `YieldAdapter` interface + `SaveYieldAdapter` (devnet SOL reserve).
- **`PolicyValidator` hardening** (authoritative program + destination derivation from the tx).
- `FarmingService` (create subwallet, deposit, withdraw, position, history) — all subwallet txs via `SigningService`.
- `FarmingAgentScheduler` (cron: auto-deposit idle, refresh+record position; bounded).
- Data model: `farming_events` + position fields.
- Session-authed farming endpoints.
- Mobile farming UI (create/fund/position/withdraw/history).

**Out of scope (mainnet/future):**
- `KaminoYieldAdapter` + reward harvest/compound (mainnet).
- KMS/HSM master key; security audit.
- USDC farming on devnet (uses the SOL reserve instead).
- Borrowing/leverage, multiple pools per subwallet, partial-protocol rebalancing.

---

## 2. `YieldAdapter` interface

```ts
interface YieldPosition { principalLamports: bigint; currentValueLamports: bigint; cTokenAmount: bigint; }

interface YieldAdapter {
  // Build a deposit of `amountLamports` (native SOL) from the subwallet into the pool. Includes
  // any reserve-refresh + wrap-SOL + create-ATA instructions the protocol requires.
  buildDeposit(subwallet: PublicKey, amountLamports: bigint): Promise<Transaction>;
  // Build a withdrawal: redeem cTokens for SOL and transfer the SOL to `ownerMainWallet`.
  buildWithdraw(subwallet: PublicKey, ownerMainWallet: PublicKey, amount: bigint | 'all'): Promise<Transaction>;
  // Read the subwallet's current position (principal, accrued value, cToken balance).
  getPosition(subwallet: PublicKey): Promise<YieldPosition>;
  // The set of program ids + destination accounts this adapter's txs are allowed to touch
  // (used to build the subwallet's policy at provisioning).
  policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey): Promise<{ programIds: string[]; destinations: string[] }>;
}
```

`SaveYieldAdapter` implements this against `@solendprotocol/solend-sdk` + the Save devnet SOL reserve. `getPosition` reads the reserve's cToken exchange rate and the subwallet's collateral-token balance to compute `currentValueLamports`.

---

## 3. Security — hardened `PolicyValidator`

The agent builds every subwallet tx, but the policy is **authoritative defense-in-depth derived from the actual tx** (never trusting the caller). Replaces the foundation's caller-provided `transferDestinations`.

- **Program allowlist:** `programIds` derived from `tx.instructions` (already authoritative) must all be in `policy.allowedProgramIds` = `[Save program, SPL Token, Associated Token, System]`.
- **Destination allowlist (NEW, authoritative):** decode every `SystemProgram.transfer` (lamport `destination`) and SPL-Token `transfer`/`transferChecked` (token `destination`) instruction in the tx; each destination must be in `policy.allowedDestinations` = the subwallet's own ATAs + the Save reserve supply accounts + the owner main wallet. Any other destination → reject + audit.
- Per-subwallet `policyJson = { allowedProgramIds: string[], allowedDestinations: string[] }`, populated at provisioning from `adapter.policyAllowlist(...)`.
- Unchanged: only the isolated `SigningService` ever materializes the key (transiently), enforces the policy pre-sign, signs, wipes; every signature + denial is audited.

**Residual risk (documented):** the subwallet is custodial-with-encryption (env-var master key on devnet). The policy bounds the blast radius to *deposits into the whitelisted Save reserve and withdrawals to the user's own main wallet* — a compromised backend cannot exfiltrate to an attacker address. KMS + audit are the mainnet gates.

---

## 4. Backend components (be/)

- **`FarmingModule`** wiring the below + the existing `SigningService`/`SubwalletService`/`OnchainModule`.
- **`SaveYieldAdapter`** (implements `YieldAdapter`).
- **`FarmingService`:**
  - `createSubwallet(userId, ownerMainWallet)` → `SubwalletService.provision(userId, policy)` where `policy = adapter.policyAllowlist(newPubkey, ownerMainWallet)`; returns the subwallet address to fund.
  - `deposit(userId, amountLamports?)` → adapter.buildDeposit → `SigningService.signTransaction(subwalletId, tx)` → submit (relayer fee payer or subwallet pays from its SOL; retry on stale-oracle revert) → record `farming_events`.
  - `withdraw(userId, amount|'all')` → adapter.buildWithdraw(owner) → sign → submit → record.
  - `getPosition(userId)` / `listHistory(userId)`.
- **`FarmingAgentScheduler`** (`@nestjs/schedule`): every N minutes, for each `active` subwallet — (1) if idle SOL > rentBuffer + minDeposit, deposit it; (2) refresh + persist the position snapshot; (3) audit the agent action. Bounded by `NAVY_FARM_MIN_INTERVAL`, `NAVY_FARM_MAX_DEPOSIT`.
- **Data (Prisma):** add to `FarmingSubwallet`: `ownerMainWallet`, `principalLamports`, `currentValueLamports`, `lastRefreshedAt`. New `FarmingEvent(id, subwalletId, kind [deposit|withdraw|refresh|agent_skip|policy_denied], amount, txSignature?, detail, createdAt)`.
- **Endpoints** (`JwtGuard + RolesGuard @Roles('user')`, scoped to `req.user.sub`): `POST /farming/subwallet`, `GET /farming` (subwallet address + position), `POST /farming/deposit`, `POST /farming/withdraw`, `GET /farming/history`.

---

## 5. Mobile (mobile/, 7b)

A **Farming** screen (linked from home):
- If no subwallet: **"Start farming"** → `POST /farming/subwallet` → shows the subwallet address + a **"Fund from wallet"** button that builds a SOL transfer (main → subwallet) and signs it with Privy `signTransaction` (sign-only, submitted by the app/relayer).
- If active: a position card — **principal, current value, yield earned, est. APY**, plus **Deposit idle now** and **Withdraw to my wallet** buttons, and an **agent activity** list (`/farming/history`).
- Logic extracted to testable plain-TS (`FarmingClient` over the endpoints; position/yield formatters); screens thin + Privy-wired.

---

## 6. Data flow

```
create subwallet (policy = Save programs + reserve + owner) → fund with SOL (main → subwallet)
agent cron: idle SOL → SaveYieldAdapter.buildDeposit → SigningService (policy-checked) → submit
   cToken balance grows in value via the reserve exchange rate (auto-compound)
GET /farming: position = cTokenAmount × exchangeRate
withdraw → buildWithdraw(owner) → redeem cTokens → SOL → transfer to owner main wallet (policy: owner-only)
```

---

## 7. Error handling & edge cases

- **Stale devnet oracle** (verified Save/Pyth caveat) → deposit/withdraw reverts → scheduler retries with backoff; persistent failure → `agent_skip` event, surfaced in history.
- Idle SOL below `rentBuffer + minDeposit` → skip deposit (don't strand rent).
- Save requires a **reserve refresh** before deposit/withdraw → the adapter prepends the refresh instruction.
- **Policy denial** (a built tx touches a non-allowlisted program/destination) → `SigningService` throws, `policy_denied` audited, that subwallet halted pending review.
- Withdraw when position < requested → withdraw `all`.
- Subwallet has no SOL for tx fees → relayer pays the fee (subwallet only authorizes), or top up; documented.
- User funds the wrong token (USDC) on devnet → only SOL is farmed; surface "fund with SOL on devnet".

---

## 8. Testing strategy

- **Unit (be):** hardened `PolicyValidator` — authoritative program + destination derivation: accept a tx whose transfers go only to self-ATAs/reserve/owner, reject a tx with a transfer to an arbitrary address even if the program is allowlisted; `FarmingService` orchestration (mocked adapter + `SigningService` + connection) for deposit/withdraw/position; `SaveYieldAdapter` position math (cTokenAmount × exchangeRate, mocked reserve state); scheduler bounds (skip below buffer, respect max). 
- **Integration (devnet, gated):** provision a subwallet → airdrop devnet SOL → agent deposit into Save SOL reserve → position reflects cTokens → withdraw to owner; assert the Save program executed and the owner received SOL. Mirrors the onchain harness; gated behind an env flag (real devnet, oracle-dependent).
- **Mobile:** `FarmingClient` + formatters (unit); farming screen typecheck + manual smoke.

---

## 9. Security flags (devnet → mainnet)

- **Env-var master key** for subwallet encryption is an accepted **devnet** risk → **KMS/HSM before mainnet** (the `Cipher` interface makes this a one-class swap).
- **Custodial-with-encryption** subwallet: bounded by the hardened policy to whitelisted Save programs + owner-only withdrawal — a compromise cannot exfiltrate to an attacker.
- **Mainnet gates:** professional **security audit** (of the policy, signing service, and adapter), the **`KaminoYieldAdapter`** + reward harvest/compound, USDC farming, and KMS.
- **Devnet oracle unreliability** is a known Save caveat — the agent's retry loop tolerates it; not a mainnet concern.

---

## 10. Deferred / future

- `KaminoYieldAdapter` (mainnet, identical-program-id code reuse), reward-token harvest + explicit compound cron, USDC farming.
- Multiple pools / auto-rebalancing across protocols; APY-driven allocation.
- KMS/HSM master key; multisig admin; full audit.
- Per-user farming risk settings (max allocation, auto-withdraw thresholds).
