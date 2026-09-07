# SRCLA Paper Conformance — Design

**Date:** 2026-09-07
**Baseline commit:** `95e8e14`
**Status:** Design approved in brainstorming; awaiting spec review
**Supersedes in scope:** `2026-09-11-srcla-gap-implementation-design.md` (that spec covered a subset; this one covers the whole paper surface)

## 1. Problem

An audit of `docs/research/output/srcla-paper.md` (v0.4) against `contract/`, `srcla/`
and `be/` found roughly thirty divergences. They are not evenly distributed, and the
largest is structural rather than a missing feature.

**The service does not run the algorithm it ships.** Four different SRCLA
implementations exist in the repository:

| Implementation | Location | Reachable from `pnpm start`? |
|---|---|---|
| Hardcoded heuristic | `srcla/src/runtime/scheduler.ts:337` → `:457` | **Yes — this is what runs** |
| `SrclaController` | `srcla/src/controller/controller.ts` | No (only via `runtime/index.ts`, imported by nothing) |
| Real policy modules | `decision/cost-gate`, `optimizer/*`, `protocols/simulation/*`, `harvest/*`, `rewards/*` | No (only via `policy-engine/index.ts`, imported by nothing) |
| Report harness | `srcla/evaluation-v2/*.mjs` (untracked) | No — produced `SRCLA-REPORT.md` v2.0 |

`scheduler.generateDecision` selects the venue with the highest lower-bound forecast,
deploys idle above a fixed 5% threshold, targets 80% in that venue, and divests 10%
from the worst — with a hardcoded 100 USDC drift threshold. That is approximately
baseline **B1** with a lower bound attached. It performs no post-deposit simulation,
runs no optimiser, applies no dependency caps, computes no dynamic reserve, and
evaluates no cost gate. `SrclaController` is better but still stubbed: its own
comments read *"In production, this would use protocol-specific simulators"*,
`deriveRegime` returns `'STEADY'` unconditionally, and `verifyEnumeration` fabricates
its result with *"Assume optimal is at most 1% better than greedy"*, yielding a
constant 1 bp regret that always passes.

§11.1 requires that all policies receive the same observations, delays, costs and
safety envelope. That cannot be true when the evaluated policy and the deployed
policy are different programs.

Beneath that sit correctness defects that make the system non-functional or
non-conformant, catalogued in §3.

## 2. Goals and non-goals

### Goals

1. One decision implementation, used by the live service and by every baseline and
   ablation in the evaluation.
2. Every §5–§10 mechanism specified by the paper is implemented, wired, and tested.
3. The registered §11 evaluation runs end to end on honest held-out data and emits a
   reproducible `PASS` or `FAIL`.
4. Amend the paper where the empirical record shows the specification itself is
   wrong, pre-registered before held-out data is touched.

### Non-goals

- Production hardening (multisig, timelock, HSM signing, redundant RPC, bug bounty).
  §2.3 places these on a separate path.
- Adding venues beyond Aave V3 / Compound III / Moonwell. §2.1 locks release one.
- Guaranteeing the release gates pass. §11.5 requires publishing a negative result as
  `FAIL`; that outcome is accepted.

## 3. Gap catalogue

Findings are grouped by subsystem. Each is closed by a section below.

### 3.1 srcla — decision path

| # | Gap | Evidence |
|---|---|---|
| S1 | Live loop is a heuristic, not SRCLA | `scheduler.ts:457` |
| S2 | Post-deposit simulation absent live; `controller.ts` uses `rate × (1 + Δu·2)` | `controller.ts:554` |
| S3 | Forecast is a 7-day quantile of raw rates, not μ̂+q_α on horizon returns | `controller.ts:596` |
| S4 | Reserve is allocation-independent; quantile term is *"Simplified: use 10% of assets"* | `controller.ts:652` |
| S5 | Enumeration regret fabricated as a constant; `exhaustive-verify.ts` (594 lines) unused | `controller.ts:771` |
| S6 | Cost gate hardcodes 30 gwei / $3 500 / 200k gas, 2 of 11 terms; `cost-gate.ts` (624 lines) unused | `controller.ts:822` |
| S7 | `deriveRegime` returns `'STEADY'` unconditionally | `controller.ts` |
| S8 | Optimiser applies `capBps` only — no absolute cap, external headroom, dependency groups, or reserve constraint | `controller.ts:725` |
| S9 | At most one action per cycle; no staged multi-action plan | `controller.ts` step 11 |
| S10 | `snapshotHash` degenerate (`marketId = totalAssets`, rate and utilisation hardcoded `'0'`) | `controller.ts` |
| S11 | Admission implements 2 rules (pause, reserve floor) against §6.2's full list | `admission/rules.ts` |
| S12 | Five barrel modules imported by nothing | `policy-engine`, `market-engine`, `evaluation-engine`, `runtime/index`, `optimizer/index` |

### 3.2 srcla — on-chain execution

| # | Gap | Evidence |
|---|---|---|
| E1 | **Every plan submission reverts.** Header sets `snapshotHash: ZeroHash`; `submitPlan` rejects `snapshotHash == bytes32(0)` with `InvalidPlan` | `keeper-executor.ts:200`, `:309` vs `NavyVaultSRCLA.sol:634` |
| E2 | Keeper targets the weak `executeAction` path, skipping config-digest recheck, risk limits, turnover, plan completion and `dynamicReserve` activation | `keeper-executor.ts:341`; packed leaf at `merkle-utils.ts:51` |
| E3 | Plan headers carry `reserve/minFinalAssets/maxRecognizedLoss/turnoverLimit` all zero | `keeper-executor.ts:203–206`, `:312–315` |
| E4 | §10.3 submission loop (DB lock, persist-before-sign, nonce check, simulate, reconcile, recover) exists in `preflight.ts`/`reconciler.ts` but is unwired | — |
| E5 | No stale-plan recovery; a wedged `activePlanId` blocks every later `submitPlan` | — |

### 3.3 contract

| # | Gap | Evidence |
|---|---|---|
| C1 | `executeAction` bypasses §9.5's mandated rechecks | `NavyVaultSRCLA.sol:669` |
| C2 | `minIdleBps` is dead config — absent from `requiredIdle()` | `:72`, `:1077` |
| C3 | No impairment value cap; `VaultTypes.AdapterConfig.accountingCap` declared and unused; no loss-recognition entry point (§5.1) | `VaultTypes.sol:29` |
| C4 | `executeHarvestAction` reads `_planActions`, which `submitPlan` never populates — harvest-in-plan unreachable | `:768` |
| C5 | `_ensureIdle` divest order is registry order, mutated by `_removeAdapter`'s swap-and-pop; §5.2 requires deterministic order | `:1082` |
| C6 | `RewardExecutor` never enforces oracle staleness; §9.4 requires "maximum ages" | `RewardExecutor.sol:310` |
| C7 | Route digest omits `block.chainid` and `pools[]`; §9.4 requires chain ID fixed | `:92` |
| C8 | `Swapped` event never emitted — harvests have no on-chain record | `:275` |
| C9 | `RewardAccountant.syncForShareAction` is a `view` no-op; §9.2's lazy refresh absent, so a stale feed closes deposits permanently | `RewardAccountant.sol:519` |
| C10 | Deprecated `latestAnswer()`; no per-route replay counter; `setDailyVolume` admin backdoor | `RewardExecutor.sol` |

### 3.4 srcla — forecast and evaluation

| # | Gap | Evidence |
|---|---|---|
| F1 | `HORIZON_GRID` declares 3 horizons × 3 coverages; `calibrateAllMethods` takes a single horizon and never traverses it | `forecast/select.ts:25` |
| F2 | All nine candidates use `q=5%` regardless of coverage target; 99% never a candidate | `select.ts`; `SRCLA-REPORT.md` §6 |
| F3 | Selection metrics fabricated: `rmse = mae × 1.2`, `sharpness = pinballLoss = loss` — §7.3's multi-term loss reduces to one scalar | `select.ts` |
| F4 | Labels are next single observations, not H-period realised returns; no availability lag | `select.ts` |
| V1 | **Policy gate inverted**: `statPass = pValue >= 0.05` passes on exactly the indistinguishability §11.5 says must fail | `release-gates.ts:113` |
| V2 | Forecast gate hardcodes `coverage >= 0.95` regardless of selected target; no exception-independence, portfolio coverage, or artifact-reproducibility check | `release-gates.ts:41` |
| V3 | Tiers are 1k/10k/100k/1M; §11.1 mandates 10k/100k/1M/**10M** | `manifest/manifest.ts:225` |
| V4 | H1–H5 match neither the paper nor the report; H5's own comment says it *"doesn't change behavior"* | `ablations/policies.ts` |
| V5 | Report generated by untracked `evaluation-v2/*.mjs`, not by `src/evaluation/` | — |

### 3.5 be and expo-wallet

| # | Gap | Evidence |
|---|---|---|
| B1 | Relayed gasless farming (EIP-3009 deposit, EIP-2612 redeem, backend pays gas) is forbidden by §2.1 and §10.2 | `be/src/vault/vault-deposit.service.ts` |
| B2 | No `approve` transaction proposal; §2.1's entry is approval followed by `deposit`/`mint` | `be/src/vault/vault.controller.ts` |
| B3 | `be` wires a `vaultAsKeeper` signer; §10.2 says the backend holds no allocator key | `be/src/evm/evm.module.ts` |
| B4 | srcla exposes `POST /v1/manifests`, `/v1/proposals/review`, `/v1/internal/trigger`; §10.2 says the read API has no mutation endpoint | `srcla/src/http/routes.ts` |
| B5 | `be` exposes `POST /vault/admin/rebalance/trigger`; §10.2 permits composing *history* only | `be/src/vault/vault-admin.controller.ts` |
| B6 | Read API missing §10.2's reserve, emergencies, active policy, synchronisation routes | `srcla/src/http/routes.ts` |

## 4. Paper amendments (v0.4 → v0.5)

`SRCLA-REPORT.md` v2.0 is an honest negative result and its findings identify places
where the *specification*, not merely the implementation, is wrong. Eight amendments
are adopted.

### 4.1 Burned-window declaration (mandatory)

The evaluation window `2026-05-26 → 2026-08-23` has been read and reasoned about. It
is therefore **design data**. The paper must state, and the manifest must enforce,
that this window lies inside the calibration era of the new dataset and never inside
the held-out era. Without this, §2.2 rejects any result derived from the amendments
below, and correctly so.

### 4.2 Amendments

**P1 — Per-venue residual quantile, solved to target (§7.1, §7.2).**
`q_{α,t}` becomes `q_{α,i,t}`, indexed by market as regimes already are. The quantile
is *solved to achieve the registered coverage target* rather than fixed at 5% and
reported post hoc. The grid explicitly crosses {3 methods} × {1, 7, 14 d} ×
{90, 95, 99 %} × method parameters, per venue.

*Evidence:* no candidate reached 95% (best 94.44%), yet per-venue coverage was
Compound 100%, Moonwell 94.87%, Aave 88.46%. A pooled fifth-percentile bound cannot
serve a smooth series and a volatile one simultaneously. All nine candidates used
`q=5%` irrespective of target; 99% was never evaluated.

**P2 — Portfolio-level lower bound (§8.2).**
The objective becomes `μ̂_p(w) + q_α^p(w)`, a calibrated bound on the portfolio
residual, replacing `Σ wᵢ ℓᵢ(wᵢV)`.

*Rationale:* a sum of marginal lower bounds implicitly assumes every venue realises
its α-quantile simultaneously. §7.3 already computes portfolio coverage as a
diagnostic; this promotes it to the optimisation target. H2 measured the current form
as pure yield cost with no risk benefit.

**P3 — Liquidity-aware reserve (§8.1).**

```
I_req(x) = max( I_floor_hard ,
                Q_β(W_H) − Σ min(xᵢ, eᵢ^cons) ,
                max_s { D_s − E_s(x) } )
```

The demand quantile is netted against conservatively executable venue exits, as the
stress term already is.

*Evidence:* H4 (dynamic reserve) produced identical results at every tier — it never
bound above the 5% floor. Gate 2b-r attributes SRCLA's deficit to that floor's cash
drag.

**P4 — Liquidity-adjusted return (§8.2).**
Each venue's objective contribution is weighted by its conservatively exitable
fraction, so a position that cannot be exited earns no ranking credit. `Q^sync` moves
from constraint-only into the objective.

*Evidence:* on 2026-07-21 Moonwell quoted 86.26% APR at 100.04% utilisation holding
$6 163 of cash. Under a return-only objective this is the most attractive venue in
the universe. It also closes report limitation #5, where that yield is booked for any
policy holding the venue.

**P5 — Structural liquidity cap (§6.1).**
Effective limit becomes `min(c^pct·V, c^abs, c^external, c^liquidity)`, where
`c^liquidity` is a deterministic function of venue free cash and utilisation that
collapses toward zero as a venue approaches its kink. No forecast required.

*Evidence:* the report concludes *"the protections that actually bound were
structural: the per-adapter cap and the idle floor. Neither depends on a forecast."*
Moonwell's utilisation sat at 85–86% with cash falling for days before the collapse.

**P6 — Venue free-cash lower bound (§7.2).**
A second registered deterministic target: a lower prediction bound on a venue's
withdrawable cash over the horizon, using the same three-candidate machinery. Feeds
`e_{i,s}` in P3 and the exitable fraction in P4.

**P7 — Reserve-matched B2 (§11.2).**
B2 is redefined to hold the same reserve as SRCLA. The unconstrained variant is
retained as a labelled diagnostic.

*Evidence:* the report had to invent "B2r" mid-flight because comparing against a
policy holding 0% idle made Gate 2b *"true and largely uninformative."*

**P8 — No-trade band and cadence reconciliation (§9.1, Appendix B).**
The action rule becomes `G_H > max(C_move, k·σ̂)`, adding hysteresis driven by
forecast uncertainty. The relationship between hourly decision cadence and a
multi-day forecast horizon is stated explicitly.

*Evidence:* movement cost on Base is ~$0.0105 per full three-venue rebalance, yet H3
still helped by 0.06–0.09 pp — the gain is churn suppression (73 rebalances versus
38), not gas. The paper cites the no-trade-region literature [3]–[6] without
specifying one.

### 4.3 Ablations restated (§11.3)

H1–H5 are restated unambiguously so implementations cannot drift, and two are added
for the new components:

| ID | Component removed |
|---|---|
| H1 | Post-deposit capacity simulation |
| H2 | Calibrated lower bounds (uncertainty) |
| H3 | Complete-cost movement gate and no-trade band |
| H4 | Dynamic reserve and stress feasibility |
| H5 | Shared-dependency caps |
| H6 | Structural liquidity cap (P5) |
| H7 | Liquidity-adjusted objective (P4) |

### 4.4 Editorial

Version → 0.5; date 2026-09-07; an **Amendment Record** section listing each change,
its evidence and the burned-window declaration; Appendix B updated with the new
registered values.

## 5. Architecture — the decision core

### 5.1 Shape

```
srcla/src/policy/
  types.ts      DecisionInput · DecisionOutput · PolicyArtifact
  input.ts      buildDecisionInput()   ← sole look-ahead barrier
  decide.ts     pure kernel
  harvest.ts    evaluateHarvest()      ← event-driven, §9.3
  steps/{admit,simulate,forecast,reserve,optimize,cost,plan}.ts
```

`decide(input, artifact)` accepts no clients, performs no I/O, and calls neither
`Date.now()` nor `Math.random()`. Two thin drivers call it:

- **live** — `scheduler` collects a finalised snapshot → `decide()` → `KeeperExecutor`
- **eval** — replay harness feeds historical snapshots → `decide()` → simulated execution

Baselines B0–B5 and ablations H1–H7 are the same kernel with named components
disabled, not separate policy functions. This is what makes §11.1 structurally true.

### 5.2 The look-ahead barrier

`buildDecisionInput()` is the only constructor of a `DecisionInput`. It filters
history to labels whose horizon has fully ended **and** whose availability lag has
passed as of `origin.timestamp`, and it segments by regime so data from a superseded
configuration cannot train the current one. Both drivers must pass through it.

A unit test asserts that no label with `horizonEnd > origin.timestamp` survives.

### 5.3 Steps

| Step | § | Behaviour |
|---|---|---|
| `admit` | 6.2–6.5 | Identity pins (proxy implementation, rate strategy, Configurator/Comptroller, code and configuration hashes), pause/freeze, incident, caps, kink sanity, oracle freshness, dependency membership, synchronous liquidity, regime minimum-history gate. Emits `reasons[]` and an eligible set |
| `simulate` | 6.3–6.5 | Protocol-exact post-deposit rate from `protocols/simulation/*`, sampled at `allocationQuantum` into a piecewise-linear curve over x |
| `forecast` | 7 | `ℓᵢ(x) = μ̂ᵢ(x) + q_{α,i}` on the horizon return, from the frozen artifact; plus the P6 free-cash bound |
| `reserve` | 8.1 | Candidate-dependent `I_req(x)` per P3, returning per-scenario feasibility flags |
| `optimize` | 8.2 | Constrained solve over conservative curves; caps `min(c^pct·V, c^abs, maxDeployable, c^liquidity)`; dependency-group caps; **stress-infeasible candidates rejected before returns are compared**; P2 portfolio bound and P4 liquidity weighting; real `exhaustiveVerify` at the same quantum with persisted regret |
| `cost` | 9.1 | Full eleven-term `C_move` with measured gas and live L1 data fee; cooldown, minimum and maximum turnover, reversal allowance, P8 no-trade band. Idle and new deposits absorb drift before any exit |
| `plan` | 9.5 | Ordered actions (divest before deploy), Merkle root over domain-bound leaves, header carrying real `snapshotHash`, `snapshotBlockNumber`, reserve, `minFinalAssets`, `maxRecognizedLoss`, `turnoverLimit`, expiry |

### 5.4 Determinism and persistence

`decisionHash` covers §10.2's full list — code commit, policy version, artifact hash,
configuration digest, snapshot hash, candidates, target, reserve, costs, reasons —
replacing the current degenerate hash. `snapshotHash` covers the canonical
raw-integer snapshot.

Schema additions (Prisma 5, `pnpm prisma:push`): `MarketSnapshot` gains the raw IRM
fields the simulators require (Comet supply/borrow/indices; Aave virtual balance,
debt, deficit, reserve factor; Moonwell cash, borrows, reserves, exchange rate)
rather than only derived `supplyRate`/`utilization`. New models: `CandidateAllocation`,
`StressCalculation`, `EnumerationResult`, `RejectionReason`, `RewardValuation`,
`SubmissionReceipt`, `Incident`. `ForecastLabel` gains `horizonEndsAt`, `availableAt`,
`regimeId`, `realizedReturn`, `realizedMinCash`.

Removed: `controller.ts`'s stubbed privates, `scheduler.generateDecision`, and the
five unimported barrels (S12).

## 6. Contracts

### 6.1 `NavyVaultSRCLA.sol`

1. **Delete** the eight-argument `executeAction` (C1), plus the superseded
   `executePlan` / `executeNextAction` / `harvest(adapter, routeId, minOut)`.
   `submitPlan` → `executeNextActionWithProof` becomes the only fund-moving route.
2. Wire `minIdleBps` into `requiredIdle()` (C2).
3. Add `AdapterConfig.liquidityFloorBps`: a deploy must leave
   `adapter.maxWithdrawable() ≥ projected · liquidityFloorBps / 1e4` (P5 on-chain half).
4. Promote `accountingCap` into the vault's `AdapterConfig`, apply as
   `min(strategyAssets, accountingCap)` in `totalAssets()`, add
   `recognizeLoss(adapter, amount)` (C3).
5. `executeHarvestAction` takes its action from a Merkle proof rather than
   `_planActions` (C4).
6. Admin-configured `withdrawalOrder[]` for `_ensureIdle` (C5).

### 6.2 `RewardExecutor.sol`

Add per-feed `maxAge` to `Route` and enforce it (C6); add `block.chainid` and
`pools[]` to `computeDigest` (C7); emit `Swapped` (C8); replace `latestAnswer()` with
`latestRoundData()` values already fetched; add a per-route swap counter for replay
protection; remove `setDailyVolume` (C10).

### 6.3 `RewardAccountant.sol`

`syncForShareAction` becomes non-view and refreshes stale material tokens (C9). The
vault holds the role permitting it; deployment scripts updated.

### 6.4 Off-chain execution

`KeeperExecutor` builds real headers, which alone fixes E1, and carries real risk
limits (E3). Leaf format moves to the domain-bound `hashPlanAction` encoding (E2).
The §10.3 loop is wired (E4): database execution lock → persist before signing →
verify nonce and chain identity → simulate against pending state → submit one action
→ reconcile receipt, events and balance deltas → re-read chain → advance or stop.
Crash recovery keys on `(planId, actionIndex, txHash, sender, nonce)`. A stale-plan
`cancelPlan` runs at cycle start (E5).

## 7. Rewards and harvest

§9.3 is event-driven and therefore **not** a step inside `decide()`. A parallel pure
function `evaluateHarvest(input) → HarvestDecision[]` runs on every 15-minute
snapshot, firing only when conservative USDC output exceeds
`C_claim + C_approve/reset + C_swap + C_L1data + C_impact + C_slippage/MEV + C_buffer`.

Eligibility (§9.2) is a `RewardAdmissionEngine` mirroring the on-chain
`RewardAccountant.TokenPolicy`: token, emission, denominator, remaining horizon,
funding, claim simulation, both Chainlink feeds and an approved Uniswap route must
all pass, else the contribution is zero.

**Phase 3 opens with an emission probe.** `SRCLA-REPORT.md` limitation #3 excluded
reward tokens entirely, and whether Aave / Compound / Moonwell Base USDC currently
emit anything material is unknown. The pipeline ships and is tested regardless —
against a fork with synthetic emissions if live emissions are negligible — and the
evaluation reports the measured contribution rather than omitting it silently.

## 8. Forecast and calibration

`src/forecast/` is rebuilt around the frozen artifact:

- `candidates/{rolling,ew-residual,direct-arx}.ts` — `fit(history, params)` and
  `predict(model, x, horizon) → {μ̂, residuals}`
- `grid.ts` — the real registered grid (F1, F2): 3 methods × {1, 7, 14 d} ×
  {90, 95, 99 %} × method parameters, per venue, quantile solved to hit target
- `loss.ts` — §7.3's published loss actually implemented (F3): point error, coverage
  deviation from target, exceedance shortfall, sharpness, downside outcomes,
  turnover, sacrificed return
- `walk-forward.ts` — rolling-origin cross-validation over completed,
  availability-lagged labels (F4); per-regime segmentation; coverage also reported on
  a non-overlapping stream with Newey–West standard errors (§7.3, [55])
- `portfolio-bound.ts` (P2), `liquidity-bound.ts` (P6)
- `artifact.ts` — the frozen `PolicyArtifact` and its content hash, immutable across
  held-out evaluation

## 9. Evaluation

**Dataset.** `evaluation-v2/collect-history.mjs` graduates into
`srcla/scripts/backfill-history.ts`: 365 days at 1-hour origins (~8 760 × 7 IRM
fields ≈ 61 000 archive calls), resumable, multi-endpoint with backoff, writing raw
integers into `MarketSnapshot`. Plus finalised `Withdraw` events for `Q_β`, and
historical ETH/USD and USDC/USD Chainlink rounds and Base L1 fee parameters so the
cost model is measured rather than assumed.

**Eras.** Calibration is the first ~9 months and contains the burned
2026-05-26→08-23 window. Held-out is the final ~3 months, sealed. The manifest fixes
the boundary and its hash before anything runs.

**Corrections.** Tiers to 10k/100k/1M/10M (V3). B0–B5 with B2 reserve-matched (P7).
H1–H7 per §4.3 (V4). Policy gate inversion fixed (V1). Forecast gate checks coverage
against the *selected* target plus exception independence, per-market and portfolio
coverage, label completeness, regime contamination and artifact reproducibility (V2).

**Fork evidence.** `contract/test/fork/SrclaEvaluationFork.t.sol` is extended so each
candidate policy replays from the same pinned prestate per §11.1. `fork-runner.ts`
drives it. `cohort-tracker.ts` and `late-depositor.ts` are wired into the replay so
§5.1 temporal fairness is reproduced.

**Reporting.** `evaluation-v2/*.mjs` retires (V5); `SRCLA-REPORT.{md,json}`
regenerates from `src/evaluation/report/`. A golden-file test pins `decide()` at
block `50355121` against the v2.0 numbers, so the fork-validated mathematics
demonstrably survives the port.

## 10. `be` and `expo-wallet`

Per §2.1 and §10.2, the relayed farming path is removed (B1): the
`/vault/deposit/*` and `/vault/redeem/*` routes, the relayed halves of
`vault-deposit.service.ts`, and the `VaultDepositAuthorization` /
`VaultRedeemPermit` models. `/vault/transactions/*` is retained and gains an
`approve` proposal (B2). `evm.module.ts` drops the `vaultAsKeeper` signer and
`NAVY_KEEPER_PRIVATE_KEY` leaves `be/.env.example` (B3). `be/scripts/vault-e2e.mjs`
is rewritten for the user-pays flow.

`expo-wallet`'s `farming.tsx` and its callers sign and broadcast `approve` +
`deposit` / `redeem` through the Privy embedded wallet. Users now pay Base gas, so an
explicit ETH-balance precheck and a clear insufficient-gas state are **required
scope**, not polish.

srcla's operator mutations move to a loopback-only listener on a separate port,
leaving `HTTP_PORT` purely read-only (B4). `be`'s
`POST /vault/admin/rebalance/trigger` is removed — §10.2 permits composing history,
and a trigger is not history (B5). The read API gains §10.2's reserve, emergencies,
active policy and synchronisation routes (B6).

## 11. Testing

Following the repository's convention: plain-TypeScript logic unit-tested; chain and
UI verified by `tsc --noEmit`, `forge test`, and gated integration runs.

**Load-bearing tests.**

- *Determinism*: same `DecisionInput` and `PolicyArtifact` ⇒ identical `decisionHash`.
- *Look-ahead barrier*: no label with `horizonEnd > origin` survives `buildDecisionInput`.
- *Golden file*: `decide()` at block `50355121` reproduces `SRCLA-REPORT.json` v2.0.
- *Foundry invariant*: **no path other than `executeNextActionWithProof` can move
  funds between adapters.** This is the property C1 breaks; asserting it prevents the
  bypass from reappearing.

**Further Foundry coverage.** `liquidityFloorBps`, `accountingCap`, `minIdleBps` in
`requiredIdle`, `RewardExecutor` `maxAge` / chain ID / `Swapped`, `RewardAccountant`
lazy refresh, deterministic withdrawal order, ERC-4626 rounding and donation
resistance, cohort fairness, pause semantics, plan ordering and replay.

**Further TypeScript coverage.** Each `decide()` step; the eleven-term cost model;
reserve candidate-dependence; enumeration regret versus greedy; grid sweep; loss
function; portfolio-bound calibration; the execution loop's crash recovery against a
mock chain.

## 12. Phasing

One branch, `feat/srcla-paper-conformance`. Each phase ends at a reviewable,
runnable checkpoint.

| Phase | Contents | Checkpoint |
|---|---|---|
| **1** | Paper → v0.5 (first task — the artifact must be frozen before calibration). Build `src/policy/`. Delete stubs, `generateDecision`, dead barrels. Fix `KeeperExecutor` headers, domain-bound leaves, §10.3 loop | Live service produces a paper-shaped decision and executes a real staged plan on the Anvil fork |
| **2** | All Solidity changes; redeploy; re-audit; `DEPLOYMENTS.md` and `.env` refresh | `forge test` green including new invariants; `vault-e2e` passes |
| **3** | Emission probe; reward pipeline on the 15-minute path; remove relayed farming from `be` and `expo-wallet`; `approve` proposal and ETH-gas UX; split srcla operator mutations off the read API | Gasless paths gone; user-pays flow works on the fork; harvest fires |
| **4** | Backfill 365 d at 1 h; freeze manifest, eras and artifact; run B0–B5, H1–H7, four tiers, fork counterfactuals, cohort accounting; regenerate report | Gates report `PASS` or `FAIL`, reproducibly |

## 13. Risks

**The gates may still fail.** P1 targets Gate 1 directly; P2, P3 and P4 attack the
yield deficit behind Gate 2b-r. None is guaranteed. §11.5 requires publishing `FAIL`
rather than retuning against held-out data, and that outcome is accepted. A
reproducible negative result is a legitimate research outcome; a passing result
obtained by peeking is not.

**Archive RPC availability.** The 61 000-call backfill relies on free public
endpoints that are archive-capable today. The collector is resumable and
multi-endpoint, but a full year of hourly state may prove partly unavailable. Fallback
is to degrade cadence for the earliest months and record the degradation in the
manifest rather than silently interpolating.

**Reward emissions may be negligible.** If so, §9.2–9.4 ships tested but contributes
zero to measured performance. This is disclosed, not hidden.

**Contract changes invalidate the existing audit.** `contract/audit/` evidence is
regenerated in Phase 2. The paper's immutability claim concerns deployed instances,
not the development lineage, so redeploying on the fork is consistent with §4.

**UX regression is real.** Removing sponsored gas means users need ETH on Base.
Accepted deliberately as the cost of §2.1 conformance.
