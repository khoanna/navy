# SRCLA Paper Conformance — Phase 3 Implementation Plan (Rewards + Client Conformance)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the reward and harvest pipeline the paper specifies, and bring the client-facing surface back inside the paper's locked release scope by removing the relayed farming path.

**Architecture:** §9.3 harvest is event-driven, not part of the allocation cycle — a parallel pure function evaluated on every snapshot, never a step inside `decide()`. On the client side, `be` stops relaying farming transactions and returns unsigned proposals the user signs; `srcla`'s read API stops carrying mutation endpoints.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify 4, Prisma 5 in `srcla/`; Nest.js 11 + Prisma 7 in `be/`; Expo/React Native in `expo-wallet/`.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md` §7 and §10
**Paper:** `docs/research/output/srcla-paper.md` (v0.5) §2.1, §9.2–9.4, §10.2
**Carried from Phase 1:** `docs/superpowers/plans/2026-09-07-srcla-phase1-outcome.md`

## Global Constraints

- **Paper §2.1 is the binding scope statement:** *"Farming has no backend relayer, EIP-3009 deposit flow, sponsored gas, or relayed redemption."* §10.2: the backend *"does not relay farming transactions"* and the read API *"has no mutation or transaction endpoint."* The user chose paper-is-law; these are not negotiable within this phase.
- **Users pay their own Base gas.** That is a deliberate UX regression accepted at design time. It must fail *legibly* — an explicit ETH-balance precheck, never an opaque revert.
- **Never fabricate reward data.** If a venue emits nothing, the correct output is zero with a stated reason, not a synthetic number. §9.2: an expired, off-chain, underfunded, unverified or unpriceable reward contributes zero.
- **`decide()` stays pure** — no I/O, no `Date.now()`, no randomness. `evaluateHarvest` must be pure on the same terms.
- Money is `bigint` in USDC base units (6 dp); rates WAD (1e18). ESM relative imports carry `.js`. Tests are `*.spec.ts`; run `pnpm test:unit` from `srcla/`, `pnpm test` from `be/`.
- **Baselines:** `srcla` 721 unit tests, `tsc` clean. `be` must remain `tsc`-clean and its suite green. Record `be`'s starting count before changing it.
- **No infrastructure:** no containers, ports, Anvil or database. Report BLOCKED rather than provisioning.
- **Commit by explicit pathspec** (`git commit -m "..." -- <paths>`); `git add` exact paths only, never `-A`.

## Task Map

| # | Task | Closes |
|---|---|---|
| 1 | Emission probe — measure whether the three venues emit anything | spec §7 opening question |
| 2 | `evaluateHarvest` + `RewardAdmissionEngine` | paper §9.2, §9.3 |
| 3 | Remove relayed farming from `be`; add the `approve` proposal | paper §2.1, §10.2 (B1, B2) |
| 4 | Drop the keeper signer from `be`; remove the rebalance trigger | paper §10.2 (B3, B5) |
| 5 | `expo-wallet` user-signed flow with an ETH-for-gas precheck | paper §2.1 |
| 6 | Split `srcla`'s mutations off the read API; add the missing read routes | paper §10.2 (B4, B6) |

---

### Task 1: Emission probe

Before building a reward pipeline, find out whether there are rewards. `SRCLA-REPORT.md` limitation #3 excluded reward tokens entirely, and nobody has measured whether Aave V3 / Compound III / Moonwell Base USDC currently emit anything material.

**Files:**
- Create: `srcla/scripts/probe-emissions.ts`
- Modify: `srcla/package.json` (add `probe:emissions`)

**Interfaces:**
- Produces: a script printing, per venue, the reward token, emission rate, remaining horizon, funding status and whether a Chainlink feed and Uniswap route exist — plus a verdict line per venue: MATERIAL / IMMATERIAL / NONE.

- [ ] **Step 1: Write the probe**

Read each venue's reward controller directly: Compound III's `CometRewards`, Aave V3's `RewardsController`, Moonwell's reward distributor. The Base addresses are in `contract/DEPLOYMENTS.md` — read them from there, do NOT hardcode from memory. For each, report the reward token, its per-second emission rate, the distribution end timestamp, and the controller's remaining funded balance.

- [ ] **Step 2: Make the verdict explicit and conservative**

A venue is MATERIAL only if it emits a token that is still within its distribution horizon AND the controller holds enough balance to pay it. Otherwise IMMATERIAL (emitting but negligible or nearly exhausted) or NONE. Print the numbers behind each verdict, not just the verdict — the point is that a later reader can check the judgement.

- [ ] **Step 3: Report BLOCKED honestly if it cannot run**

The probe needs a Base RPC. If `BASE_RPC_URL` is unset and no fork is running, do NOT start one and do NOT invent numbers. Report BLOCKED with the exact command an operator needs. The script must still typecheck and be committed.

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit` (note `scripts/` is covered by `tsconfig.scripts.json` since Phase 1) and `pnpm typecheck:scripts`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): probe live reward emissions at the three venues

SRCLA-REPORT limitation #3 excluded reward tokens and nobody has measured
whether the venues emit anything material. Prints emission rate, horizon,
funding and route/feed availability per venue with an explicit verdict.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- srcla/scripts/probe-emissions.ts srcla/package.json
```

---

### Task 2: `evaluateHarvest` and `RewardAdmissionEngine`

§9.3 is explicit that harvest is event-driven and NOT part of the allocation cycle: *"There is no weekly or fixed-period harvest transaction... SRCLA attempts a harvest when claimable value is material and conservative USDC output exceeds cost."* So this is a parallel pure function on the 15-minute snapshot path, not an eighth step in `decide()`.

**Files:**
- Create: `srcla/src/policy/harvest.ts`
- Create: `srcla/src/policy/steps/reward-admission.ts`
- Test: `srcla/test/unit/policy/harvest.spec.ts`

**Interfaces:**
- Consumes: `DecisionInput`, `GasObservation`, `PolicyArtifact` from `src/policy/types.js`; `movementCostBase` and `MOVE_COST_TERMS` from `src/policy/steps/cost.js`.
- Produces:
  - `admitReward(obs: RewardObservation, policy: RewardTokenPolicy): { admitted: boolean; reasons: Array<{code: string; passed: boolean; detail: string}> }`
  - `evaluateHarvest(input: DecisionInput, artifact: PolicyArtifact, params: HarvestParams): HarvestDecision[]`
  - `interface HarvestDecision { adapter, token, claimableBase, conservativeOutBase, costBase, terms, fire: boolean, reason: string }`

- [ ] **Step 1: Write the failing tests**

Cover, each as its own case: a reward whose token is unadmitted contributes zero and never fires; a reward past its emission end never fires; an underfunded controller never fires; a stale or invalid price feed never fires AND never raises the recognised value; a reward with no approved Uniswap route never fires; a claimable value below the material threshold does not fire; a claimable value whose conservative output exceeds the full cost DOES fire; and one where output exceeds gas but not the full §9.3 cost sum does NOT fire.

That last pair is the important one — it is the difference between a real economic gate and a threshold that looks like one.

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm test:unit -- harvest`
Expected: module not found.

- [ ] **Step 3: Implement `admitReward`**

§9.2's eligibility list, each as a named reason code: `TOKEN_NOT_ADMITTED`, `EMISSION_ENDED`, `UNDERFUNDED`, `CLAIM_SIMULATION_FAILED`, `FEED_STALE`, `FEED_INVALID`, `NO_APPROVED_ROUTE`, `OK`. A failure on any one yields zero contribution — never a partial credit.

- [ ] **Step 4: Implement `evaluateHarvest`**

Fire only when `conservativeOut > C_claim + C_approve/reset + C_swap + C_L1data + C_impact + C_slippage/MEV + C_buffer`. Reuse `movementCostBase` rather than recomputing costs — that function already carries the eleven-term model and its blob-based L1 pricing, and duplicating it is how the two would drift. Apply the token-specific haircut and the absolute contribution cap from §9.2. Purity as for `decide()`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test:unit -- harvest && pnpm exec tsc --noEmit`, then the full `pnpm test:unit`.

```bash
git commit -m "feat(policy): event-driven harvest gate and reward admission

Paper 9.3 makes harvest event-driven rather than part of the allocation cycle,
so this is a parallel pure function on the snapshot path, not a step inside
decide(). Reuses the eleven-term cost model rather than recomputing it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK" -- srcla/src/policy/harvest.ts srcla/src/policy/steps/reward-admission.ts srcla/test/unit/policy/harvest.spec.ts
```

---

### Task 3: Remove relayed farming from `be`; add the `approve` proposal

Paper §2.1 forbids a backend relayer, an EIP-3009 deposit flow, sponsored gas and relayed redemption for farming. `be` currently does all four.

**Files:**
- Modify: `be/src/vault/vault-deposit.controller.ts`, `be/src/vault/vault-deposit.service.ts`, `be/src/vault/vault.controller.ts`, `be/src/vault/vault.module.ts`
- Modify: `be/prisma/schema.prisma` (drop `VaultDepositAuthorization`, `VaultRedeemPermit` if nothing else reads them)
- Test: `be/test/unit/vault/*`

**Interfaces:**
- Removes: `POST /vault/deposit/authorization`, `POST /vault/deposit/submit`, `POST /vault/redeem/permit`, `POST /vault/redeem/submit`.
- Produces: `POST /vault/transactions/approve` returning an unsigned ERC-20 `approve` transaction for the vault as spender, alongside the existing `deposit`, `redeem` and `withdraw` proposals.

- [ ] **Step 1: Record the baseline**

Run from `be/`: `pnpm test 2>&1 | tail -5` and record the passing count. You will need it to account for deletions.

- [ ] **Step 2: Add the `approve` proposal first, before deleting anything**

§2.1's entry path is *"USDC approval followed by `deposit` or `mint`"*, and only `deposit`, `redeem` and `withdraw` proposals exist. Add `approve` and test it returns a well-formed unsigned transaction with the correct `to` (USDC), spender (the vault) and amount. Adding the replacement before removing the incumbent means the capability is never absent.

- [ ] **Step 3: Delete the relayed routes and service paths**

Remove the four routes and the relayed halves of `vault-deposit.service.ts`. Delete tests that covered ONLY the relayed flow, naming each in your report. Any test covering behaviour that survives must be ported, not deleted.

- [ ] **Step 4: Drop the now-dead Prisma models**

`VaultDepositAuthorization` and `VaultRedeemPermit` exist to hold relayed-flow nonces. Confirm with `grep` that nothing else reads them, then remove them from `be/prisma/schema.prisma`. `be` is **Prisma 7** with a driver adapter via `be/prisma.config.ts` — note the CLI needs `DATABASE_URL` in the shell env. If no database is reachable, edit the schema and run `pnpm prisma generate` only; do NOT run a migration and do NOT start a database. Report that the migration is outstanding.

- [ ] **Step 5: Verify and commit**

Run from `be/`: `pnpm exec tsc --noEmit` and `pnpm test`. Report the count against your baseline with every change accounted for.

---

### Task 4: Drop the keeper signer from `be`; remove the rebalance trigger

§10.2: the backend *"does not relay farming transactions, possess the allocator key, or execute rebalances."* `be` wires a `vaultAsKeeper` signer and exposes `POST /vault/admin/rebalance/trigger`.

**Files:**
- Modify: `be/src/evm/evm.module.ts`, `be/src/vault/vault-admin.controller.ts`, `be/.env.example`, `be/scripts/vault-e2e.mjs`

- [ ] **Step 1: Remove the keeper signer**

Delete the `vaultAsKeeper` wiring from `evm.module.ts` and `NAVY_KEEPER_PRIVATE_KEY` from `be/.env.example`. Confirm with `grep -rn "vaultAsKeeper\|NAVY_KEEPER_PRIVATE_KEY" be/src be/scripts` that nothing still reads them. If something does, report it rather than deleting its caller.

- [ ] **Step 2: Remove the rebalance trigger**

Delete `POST /vault/admin/rebalance/trigger`. The paper permits `be` to compose SRCLA *history* over HTTP; a trigger is not history. The read proxies (`strategy`, `decisions`, `harvests`, `cohorts`, `rebalance/status`, `rebalance/proposals`) all stay.

- [ ] **Step 3: Rewrite `vault-e2e.mjs` for the user-pays flow**

It currently drives the relayed path. Rewrite it to: request the `approve` proposal, sign and broadcast it with a test key, request the `deposit` proposal, sign and broadcast, then assert the position. Mark clearly that it requires a funded EOA and a live chain, and that it is not run in this phase.

- [ ] **Step 4: Verify and commit**

Run from `be/`: `pnpm exec tsc --noEmit` and `pnpm test`.

---

### Task 5: `expo-wallet` user-signed flow with an ETH-for-gas precheck

Users now pay their own Base gas. The failure must be legible.

**Files:**
- Modify: `expo-wallet/app/(tabs)/farming.tsx` and whichever `src/lib` module calls the deposit and redeem endpoints
- Test: `expo-wallet/src/lib/**` (plain-TS logic only)

- [ ] **Step 1: Find the callers**

`grep -rn "vault/deposit\|vault/redeem" expo-wallet/src expo-wallet/app`. Those endpoints no longer exist after Task 3.

- [ ] **Step 2: Put the gas check in plain TypeScript, not the screen**

Write `hasSufficientGas(ethBalanceWei: bigint, estimatedGasWei: bigint, bufferBps: number): { ok: boolean; shortfallWei: bigint }` in `expo-wallet/src/lib/`, and unit-test it. The repo's convention is that logic lives in testable plain-TS modules while screens stay thin — and a screen-embedded balance check cannot be tested at all.

- [ ] **Step 3: Switch the screens to the proposal flow**

Request `approve`, have the user sign and broadcast via the Privy embedded wallet, then `deposit`. Before either, check the gas precondition and render an explicit "you need ETH on Base for gas, short by X" state. An opaque revert is the outcome this exists to prevent.

- [ ] **Step 4: Verify and commit**

Run from `expo-wallet/`: `pnpm exec tsc --noEmit` and `pnpm test`. Screens are not unit-testable here — `tsc` is their gate, and say so.

---

### Task 6: Split `srcla`'s mutations off the read API; add the missing read routes

§10.2: the read API *"has no mutation or transaction endpoint."* `srcla` serves `POST /v1/manifests`, `POST /v1/proposals/review` and `POST /v1/internal/trigger` on the same listener as its reads.

**Files:**
- Modify: `srcla/src/http/server.ts`, `srcla/src/http/routes.ts`, `srcla/src/index.ts`, `srcla/src/config.ts`
- Create: `srcla/src/http/operator-routes.ts`
- Test: `srcla/test/unit/http/*`

- [ ] **Step 1: Move the three mutations to a loopback-only operator listener**

A second Fastify instance bound to `127.0.0.1` on its own port (`OPERATOR_HTTP_PORT`, default 3101). The public listener on `HTTP_PORT` keeps only `GET` routes. Add a test asserting no `POST` route is registered on the public server — enumerate the route table rather than probing paths, so a future addition is caught automatically.

Note `POST /v1/internal/trigger` is the repository owner's own feature, committed early in this work. It moves, it does not disappear.

- [ ] **Step 2: Add the read routes §10.2 names but `srcla` lacks**

`GET /v1/reserve` (current required reserve and its components), `GET /v1/emergencies`, `GET /v1/policy` (the active frozen artifact and its hash), `GET /v1/sync` (collector synchronisation status). Each returns real data or an explicit empty result — never a placeholder shape.

- [ ] **Step 3: Update `be`'s `SrclaClient` if any proxied path moved**

`be/src/vault/srcla-client.ts` reads `SRCLA_API_URL`. The read paths are unchanged, so this should be a no-op — confirm it, and say so.

- [ ] **Step 4: Verify and commit**

Run from `srcla/`: `pnpm exec tsc --noEmit` and `pnpm test:unit`. From `be/`: `pnpm exec tsc --noEmit`.

---

## Phase 3 Exit Criteria

- [ ] `grep -rn "receiveWithAuthorization\|depositWithAuthorization" be/src` returns nothing in the farming path
- [ ] `grep -rn "vaultAsKeeper\|NAVY_KEEPER_PRIVATE_KEY" be/src be/.env.example` returns nothing
- [ ] No `POST` route registered on `srcla`'s public listener, asserted by a test over the route table
- [ ] `srcla` `pnpm test:unit` green with the harvest suite added; `tsc` clean
- [ ] `be` `pnpm test` green against its recorded baseline, every delta accounted for; `tsc` clean
- [ ] `expo-wallet` `tsc --noEmit` clean; `hasSufficientGas` unit-tested
- [ ] Emission probe committed, with its result or an explicit BLOCKED

## Self-Review Notes

- **Spec coverage:** spec §7 → Tasks 1–2; §10 → Tasks 3–6.
- **Deliberately out of scope:** the collector's hardcoded zero market data (Phase 4's blocker, and the largest open gap), the §6.2 oracle-freshness admission rule, §10.3 balance-delta reconciliation, and the three pre-existing invariant defects found in Phase 2.
- **Ordering rationale:** Task 1 first because its result determines whether Task 2's pipeline has anything real to act on. Task 3 before 4 because 4 rewrites the e2e script that 3's routes change. Task 5 after 3 because it consumes the endpoints 3 creates.
- **Known risk:** Task 3 touches `be`, which has its own Prisma 7 setup and a database this session cannot reach. The schema edit and `prisma generate` are safe offline; the migration is not, and is expected to be reported outstanding.
