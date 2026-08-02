# SRCLA Controller and Execution Implementation Plan (Plan 5 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the paper's deterministic admit → simulate → forecast → reserve → optimize → cost/emergency → staged execute pipeline in `/srcla`, including walk-forward calibration, exact decision hashes, allocator key isolation, and receipt-based recovery.

**Architecture:** Framework-free TypeScript functions consume immutable snapshot/policy records and return fully explained results. The hourly orchestrator persists every intermediate result before any signing. A single executor uses the allocator key only after deterministic preflight, submits one ordered vault action, reconciles chain truth, and recomputes before continuing.

**Tech Stack:** TypeScript, ethers v6, Prisma/PostgreSQL, Jest/property tests, Foundry/Anvil golden vectors from Plans 1–3.

## Global Constraints

- Depends on Plans 1–4.
- Forecasting is deterministic and auditable; no AI/LLM provider and no custom ML model.
- Compare rolling historical distribution, EW forecast with calibrated residuals, and fixed direct-horizon ARX.
- Pre-register horizons 1/7/14 days and lower prediction coverage 90/95/99%; calibration selects and freezes one before held-out evaluation.
- Configuration/code changes create a new regime and make the market ineligible until its new minimum-data gate passes.
- New idle deposits correct drift first; existing positions move only when full conservative gain clears every cost and safety buffer.
- Emergency exit bypasses the economic gate but remains adapter-to-vault only.
- Same input snapshot, policy version, model artifact, and code commit must produce the same decision hash.
- One allocator wallet and one active executor; database status never overrides chain truth.

---

### Task 1: Define canonical policy, result types, hashing, and preregistration validation

**Files:**
- Create: `srcla/src/domain/policy.ts`
- Create: `srcla/src/domain/results.ts`
- Create: `srcla/src/domain/canonical-json.ts`
- Create: `srcla/src/domain/decision-hash.ts`
- Create: `srcla/src/domain/decision-hash.spec.ts`
- Create: `srcla/config/policy-candidates.json`

**Interfaces:**
- Produces: `SrclaPolicy`, `AdmissionResult`, `RateCurve`, `ForecastResult`, `ReserveResult`, `AllocationDecision`, `CostDecision`, `canonicalJson`, and `decisionHash`.

- [ ] **Step 1: Write deterministic serialization tests**

```typescript
it('hashes equal semantic inputs identically regardless of property insertion order', () => {
  expect(decisionHash({ b: 2n, a: 1n })).toBe(decisionHash({ a: 1n, b: 2n }));
});

it('rejects unregistered horizon and coverage candidates', () => {
  expect(() => parsePolicy({ ...validPolicy, horizonSeconds: 3 * DAY })).toThrow(/preregistered/i);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- decision-hash`

Expected: FAIL because domain types and hashing are absent.

- [ ] **Step 3: Implement canonical types and hashing**

```typescript
export interface SrclaPolicy {
  id: string;
  regimeIds: Record<string, string>;
  horizonSeconds: 86_400 | 604_800 | 1_209_600;
  coverageBps: 9_000 | 9_500 | 9_900;
  forecastMethod: 'rolling' | 'ew-residual' | 'direct-arx';
  allocationQuantumBps: number;
  adminIdleFloorBase: bigint;
  cooldownSeconds: number;
  turnoverBudgetBps: number;
}
```

Canonical JSON sorts object keys and explicitly encodes bigint as `{ "$bigint": "123" }`; arrays retain order. Hash UTF-8 canonical JSON with SHA-256 and prefix `0x`.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd srcla && pnpm test -- decision-hash && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/domain srcla/config/policy-candidates.json
git commit -m "feat(srcla): define canonical policy and decision records"
```

---

### Task 2: Implement hard market admission and regime quarantine

**Files:**
- Create: `srcla/src/admission/admission-engine.ts`
- Create: `srcla/src/admission/rules.ts`
- Create: `srcla/src/admission/admission-engine.spec.ts`
- Create: `srcla/src/admission/fixtures/*.json`

**Interfaces:**
- Produces: `evaluateAdmission(snapshot, policy, regime): AdmissionResult` and `deriveRegimeIdentity(snapshot): string`.

- [ ] **Step 1: Write one-failure-per-rule tests**

```typescript
it.each([
  ['stale snapshot', { ageSeconds: 901 }, 'STALE_DATA'],
  ['paused market', { paused: true }, 'MARKET_PAUSED'],
  ['implementation drift', { implementationHash: '0xchanged' }, 'CONFIG_CHANGED'],
  ['cap exhausted', { capHeadroomBase: 0n }, 'NO_CAPACITY'],
])('rejects %s deterministically', (_name, patch, code) => {
  expect(evaluateAdmission(withPatch(snapshot, patch), policy, regime).reasonCodes).toContain(code);
});
```

Cover exact chain/asset/market identity, proxy/code/configuration digest, rate model, active/freeze/pause, supply headroom, protocol cash, reward/oracle/route state, kink buffer, incident flag, minimum history, and shared dependency policy. Multiple failures return a sorted complete reason list.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- admission-engine`

Expected: FAIL before the engine exists.

- [ ] **Step 3: Implement pure hard-gate rules**

```typescript
export function evaluateAdmission(s: MarketSnapshot, p: AdmissionPolicy, r: ContractRegime): AdmissionResult {
  const reasons = rules.flatMap((rule) => rule(s, p, r));
  return { marketId: s.marketId, eligible: reasons.length === 0, reasonCodes: reasons.sort() };
}
```

`deriveRegimeIdentity` hashes all mutable implementation, rate model, reward controller, oracle, and material configuration identities. A changed identity creates a new `ContractRegime` row and forces `INSUFFICIENT_REGIME_HISTORY` until the configured completed-label count passes.

- [ ] **Step 4: Run tests and deterministic-order property check**

Run: `cd srcla && pnpm test -- admission-engine`

Expected: PASS for fixtures presented in any input ordering.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/admission
git commit -m "feat(srcla): enforce hard market admission and regimes"
```

---

### Task 3: Implement exact Aave, Compound, and Moonwell post-deposit simulators

**Files:**
- Create: `srcla/src/protocols/protocol-simulator.ts`
- Create: `srcla/src/protocols/aave-v3.ts`
- Create: `srcla/src/protocols/compound-v3.ts`
- Create: `srcla/src/protocols/moonwell.ts`
- Create: `srcla/src/protocols/math.ts`
- Create: `srcla/src/protocols/protocol-simulator.spec.ts`
- Create: `srcla/src/protocols/fixtures/*.json`
- Create: `srcla/scripts/verify-vectors.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Produces: `ProtocolSimulator.simulate(snapshot, candidateAssets, horizonStart): RatePoint` and `maxExecutableExit(snapshot, position): bigint`.

- [ ] **Step 1: Import fork golden vectors and write exact-equality tests**

```typescript
it.each(loadGoldenVectors())('$protocol $case matches fork output', (v) => {
  const result = simulators[v.protocol].simulate(v.snapshot, BigInt(v.depositBase), v.timestamp);
  expect(result.supplyRatePerSecondE18).toBe(BigInt(v.expectedRateE18));
  expect(result.postUtilizationE18).toBe(BigInt(v.expectedUtilizationE18));
});
```

Vectors cover zero deposit, below kink, kink boundary, above kink, cap boundary, accrued timestamp, integer rounding, reward end within horizon, and cash-limited exit.

- [ ] **Step 2: Run and confirm missing simulator failure**

Run: `cd srcla && pnpm test -- protocol-simulator`

Expected: FAIL.

- [ ] **Step 3: Implement bigint-only protocol math**

```typescript
export interface RatePoint {
  candidateAssetsBase: bigint;
  postUtilizationE18: bigint;
  supplyRatePerSecondE18: bigint;
  baseReturnHorizonE18: bigint;
  knownRewardReturnHorizonE18: bigint;
  maxExecutableExitBase: bigint;
  rawInputHash: string;
}
```

Aave mirrors accrued indices, virtual balance/liquidity added, debt, reserve factor, and registered V2 strategy rounding. Compound accrues supply/borrow indices, principal/present value, candidate utilization, and live piecewise supply curve. Moonwell accrues cash/borrows/reserves, applies the jump model and strict cap, then exchange-rate/mToken truncation. Never convert chain math through JavaScript `number`.

Implement `verify-vectors.ts` as a pinned-block reader/comparator and register `"vectors:verify": "node dist/scripts/verify-vectors.js"`.

- [ ] **Step 4: Run golden vectors and cross-check a live pinned block**

Run: `cd srcla && pnpm test -- protocol-simulator`

Run with Anvil/fork fixtures: `cd srcla && source .env && pnpm run vectors:verify -- --block 49436925`

Expected: exact rate/input equality or explicitly registered protocol dust bounds.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/protocols srcla/scripts/verify-vectors.ts srcla/package.json
git commit -m "feat(srcla): simulate protocol-exact post-deposit returns"
```

---

### Task 4: Implement deterministic forecasting and walk-forward calibration

**Files:**
- Create: `srcla/src/forecast/types.ts`
- Create: `srcla/src/forecast/rolling.ts`
- Create: `srcla/src/forecast/ew-residual.ts`
- Create: `srcla/src/forecast/direct-arx.ts`
- Create: `srcla/src/forecast/walk-forward.ts`
- Create: `srcla/src/forecast/calibration.ts`
- Create: `srcla/src/forecast/forecast.spec.ts`
- Create: `srcla/src/forecast/no-lookahead.spec.ts`
- Create: `srcla/scripts/run-forecast-fixture.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Produces: `ForecastModel.fit(completedLabels)`, `predict(origin, rateCurve)`, `runWalkForward`, and `selectFrozenPolicy`.

- [ ] **Step 1: Write no-look-ahead and lower-bound tests**

```typescript
it('never trains on a label whose horizon ends after the forecast origin', () => {
  const rows = eligibleTrainingRows(labels, origin, availabilityLag);
  expect(rows.every((r) => r.endTimestamp <= origin - availabilityLag)).toBe(true);
});

it('lower prediction bound equals point forecast plus calibrated lower residual quantile', () => {
  expect(result.lowerReturnE18).toBe(result.meanReturnE18 + result.lowerResidualQuantileE18);
});
```

Test overlapping horizons, non-overlapping formal calibration stream, deterministic quantiles/ties, EW initialization/decay, fixed ARX feature order, singular matrix rejection, regime separation, reward-on/off windows, and insufficient sample rejection.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- forecast no-lookahead`

Expected: FAIL before forecast modules exist.

- [ ] **Step 3: Implement all three registered methods and frozen selection**

```typescript
export interface ForecastResult {
  method: 'rolling' | 'ew-residual' | 'direct-arx';
  horizonSeconds: number;
  coverageBps: number;
  meanReturnE18: bigint;
  lowerReturnE18: bigint;
  lowerResidualQuantileE18: bigint;
  completedLabelCount: number;
  modelArtifactHash: string;
}
```

Calibration evaluates only the registered 3×3×3 method/horizon/coverage grid under the published loss function. It persists every candidate, selects with fixed lexical tie-breaking, writes an immutable model artifact/parameter JSON, and refuses to evaluate held-out rows until that artifact is activated.

Implement the fixture runner to print only the artifact and result hashes after a successful replay; register `"forecast:fixture": "node dist/scripts/run-forecast-fixture.js"`.

- [ ] **Step 4: Run forecast tests and a deterministic replay twice**

Run: `cd srcla && pnpm test -- forecast no-lookahead && pnpm run forecast:fixture && pnpm run forecast:fixture`

Expected: both fixture runs print the same artifact and result hashes.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/forecast srcla/scripts/run-forecast-fixture.ts srcla/package.json
git commit -m "feat(srcla): calibrate deterministic lower return forecasts"
```

---

### Task 5: Implement dynamic reserve, stress feasibility, and constrained allocation

**Files:**
- Create: `srcla/src/reserve/withdrawal-series.ts`
- Create: `srcla/src/reserve/stress.ts`
- Create: `srcla/src/reserve/reserve.ts`
- Create: `srcla/scripts/check-optimizer-fixtures.ts`
- Modify: `srcla/package.json`
- Create: `srcla/src/reserve/reserve.spec.ts`
- Create: `srcla/src/optimizer/piecewise.ts`
- Create: `srcla/src/optimizer/optimizer.ts`
- Create: `srcla/src/optimizer/optimizer.spec.ts`

**Interfaces:**
- Produces: `calculateReserve(input): ReserveResult` and `optimizeAllocation(input): AllocationDecision`.

- [ ] **Step 1: Write reserve and feasibility tests from the paper**

```typescript
it('uses the maximum floor, demand quantile, and stress shortfall', () => {
  expect(calculateReserve(input).requiredIdleBase).toBe(12_000n);
});

it('rejects nominally diversified targets sharing a capped dependency', () => {
  const result = optimizeAllocation(sharedOracleFixture);
  expect(result.rejections).toContainEqual(expect.objectContaining({ code: 'DEPENDENCY_CAP' }));
});
```

Cover stressed executable exits, every scenario, disabled markets at zero, market percentage/absolute caps, dependency caps, dynamic reserve, exact sum to NAV, post-deposit curves, negative lower returns, deterministic ties, and late-depositor cohort accounting.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- reserve optimizer`

Expected: FAIL before reserve/optimizer modules exist.

- [ ] **Step 3: Implement deterministic reserve and piecewise optimization**

```typescript
const requiredIdleBase = maxBigInt(adminFloorBase, withdrawalQuantileBase, ...stressShortfallsBase);

export function optimizeAllocation(input: OptimizerInput): AllocationDecision {
  const curves = input.markets.map((m) => piecewiseApproximate(m.lowerReturnCurve, input.quantumBps));
  return deterministicConstrainedSearch(curves, input.constraints, { tieBreak: 'market-id-ascending' });
}
```

For the three-market release universe, compare the solver result with exhaustive enumeration at the same quantum and persist approximation regret. Keep market/dependency data generic so adding a protocol does not require new optimizer branches.

Implement the fixture checker with the independent enumerator used only by tests; register `"optimizer:exhaustive-fixtures": "node dist/scripts/check-optimizer-fixtures.js"`.

- [ ] **Step 4: Run property tests and exhaustive cross-check**

Run: `cd srcla && pnpm test -- reserve optimizer && pnpm run optimizer:exhaustive-fixtures`

Expected: solver equals exhaustive best feasible objective for every fixture and never violates a hard constraint.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/reserve srcla/src/optimizer srcla/scripts/check-optimizer-fixtures.ts srcla/package.json
git commit -m "feat(srcla): optimize stress-feasible lending allocation"
```

---

### Task 6: Implement full-cost, cooldown, turnover, and emergency decisions

**Files:**
- Create: `srcla/src/decision/costs.ts`
- Create: `srcla/src/decision/action-decision.ts`
- Create: `srcla/src/decision/action-decision.spec.ts`
- Create: `srcla/src/rewards/harvest-decision.ts`
- Create: `srcla/src/rewards/harvest-decision.spec.ts`

**Interfaces:**
- Produces: `decideActions(current, target, costs, policy)` and `decideHarvest(observation, quote, costs, policy)`.

- [ ] **Step 1: Write economic gate and safety override tests**

```typescript
it('moves only when conservative horizon gain clears every cost and buffer', () => {
  expect(decideActions(fixture({ gain: 100n, fullCost: 101n })).actions).toHaveLength(0);
  expect(decideActions(fixture({ gain: 102n, fullCost: 101n })).actions).not.toHaveLength(0);
});

it('emergency divest bypasses cost but never creates a deployment', () => {
  const d = decideActions(ineligibleCurrentFixture);
  expect(d.actions.every((a) => a.kind === 'emergency-divest')).toBe(true);
});
```

Cover Base L2 and L1 data fee, ETH→USDC conversion, entry/exit, claim, exact approval/reset, Uniswap output impact, slippage/MEV, failed-attempt and reversal allowance, cooldown, turnover, deposit-first drift correction, reward end, and no profitable route.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- action-decision harvest-decision`

Expected: FAIL.

- [ ] **Step 3: Implement dollar-denominated conservative decisions**

```typescript
const fullCostBase = l2FeeBase + l1DataFeeBase + exitCostBase + entryCostBase +
  claimCostBase + approvalResetCostBase + swapImpactBase + slippageMevBase +
  reversalAllowanceBase + safetyBufferBase;
const shouldMove = safetyExit || conservativeGainBase > fullCostBase;
```

Generate divests before deploys. New idle deployment has no exit cost. Harvest requires the same strict `>` rule and emits no action when any eligibility/oracle/route input is invalid.

- [ ] **Step 4: Run decision tests and old-vs-new regression fixtures**

Run: `cd srcla && pnpm test -- action-decision harvest-decision`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/decision srcla/src/rewards
git commit -m "feat(srcla): gate moves and harvests by full conservative cost"
```

---

### Task 7: Build, submit, and reconcile staged vault plans

**Files:**
- Modify: `srcla/src/config.ts`
- Modify: `srcla/.env.example`
- Create: `srcla/src/execution/plan-builder.ts`
- Create: `srcla/src/execution/preflight.ts`
- Create: `srcla/src/execution/nonce-manager.ts`
- Create: `srcla/src/execution/executor.ts`
- Create: `srcla/src/execution/reconciler.ts`
- Create: `srcla/src/execution/executor.spec.ts`
- Create: `srcla/src/execution/recovery.spec.ts`
- Create: `srcla/scripts/e2e-anvil.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Produces: `buildPlan`, `preflightAction`, `executeNextAction`, and `recoverAllocatorState`.

- [ ] **Step 1: Write partial-plan, nonce, and crash recovery tests**

```typescript
it('never advances after a reverted action and recomputes from live state', async () => {
  chain.receipt = revertedReceipt;
  await executor.reconcile(plan.actions[0]);
  expect(await plans.nextExecutable(plan.id)).toBeNull();
  expect(recompute.enqueue).toHaveBeenCalledWith(plan.id);
});

it('recovers a submitted transaction by sender and nonce before replacement', async () => {
  await reconciler.recoverAllocatorState();
  expect(transactions.findBySenderNonce).toHaveBeenCalled();
});
```

Cover database lock, persisted-before-signing, config digest drift, action Merkle proofs, pending-state simulation, expired plan, balance-delta mismatch, confirmation, revert, dropped/replaced transaction, process crash, nonce collision, and emergency action.

- [ ] **Step 2: Add allocator-key configuration and confirm tests fail**

Add `SRCLA_ALLOCATOR_PRIVATE_KEY` as a required secret only for `EXECUTION_ENABLED=true`. Ensure logs and config snapshots redact it.

Run: `cd srcla && pnpm test -- executor recovery`

Expected: FAIL before execution modules exist.

- [ ] **Step 3: Implement single-action execution and chain-first recovery**

```typescript
await lock.withLock('srcla:executor', async () => {
  await actions.markPrepared(action.id, txRequest, sender, nonce);
  await preflightAction(action, 'pending');
  const sent = await wallet.sendTransaction(txRequest);
  await actions.markSubmitted(action.id, sent.hash);
});
```

After receipt, decode vault events and compare expected/actual idle, adapter, reward, and NAV deltas before marking confirmed. On any divergence, stop the plan and alert. Never submit a later action based only on optimistic database state.

Implement the Anvil script as a self-contained fixture driver and register `"e2e:anvil": "node dist/scripts/e2e-anvil.js"`.

- [ ] **Step 4: Run execution tests and a local Anvil staged-plan E2E**

Run: `cd srcla && pnpm test -- executor recovery`

Run after starting the pinned local fork: `cd srcla && EXECUTION_ENABLED=true pnpm run e2e:anvil -- staged-plan`

Expected: deposit → divest → failed deploy leaves idle → recompute → successful deploy → reconcile all pass.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/config.ts srcla/.env.example srcla/src/execution srcla/scripts/e2e-anvil.ts srcla/package.json
git commit -m "feat(srcla): execute and recover staged vault plans"
```

---

### Task 8: Wire the hourly controller and decision API records

**Files:**
- Create: `srcla/src/controller/controller.ts`
- Create: `srcla/src/controller/controller.spec.ts`
- Modify: `srcla/src/runtime/scheduler.ts`
- Modify: `srcla/src/http/routes.ts`
- Modify: `srcla/src/main.ts`
- Modify: `srcla/README.md`

**Interfaces:**
- Produces: `Controller.evaluateLatest()` and hourly `srcla:decision` job.

- [ ] **Step 1: Write end-to-end pure-pipeline ordering tests**

```typescript
it('persists admission through action decision before exposing a decision hash', async () => {
  const result = await controller.evaluateLatest();
  expect(calls).toEqual(['load', 'admit', 'simulate', 'forecast', 'reserve', 'optimize', 'cost', 'persist']);
  expect(result.decisionHash).toMatch(/^0x[0-9a-f]{64}$/);
});
```

Test no complete snapshot, inactive policy, quarantined market, identical repeated evaluation, decision persisted before plan, execution disabled, and emergency alert.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- controller`

Expected: FAIL before controller exists.

- [ ] **Step 3: Wire the deterministic pipeline and UTC hourly schedule**

```typescript
const admissions = snapshots.markets.map((m) => evaluateAdmission(m, policy.admission, regimes[m.id]));
const curves = simulateEligible(admissions, snapshots, policy);
const forecasts = forecast(curves, history, policy);
const reserve = calculateReserve(buildReserveInput(snapshots, history, policy));
const allocation = optimizeAllocation({ forecasts, reserve, constraints: policy.constraints });
const actionDecision = decideActions(current, allocation, estimateCosts(snapshots), policy);
return decisions.persistCanonical({ admissions, curves, forecasts, reserve, allocation, actionDecision });
```

The scheduler evaluates on UTC hour boundaries under the `srcla:decision` advisory lock. Execution starts only after the decision transaction commits and only when enabled.

- [ ] **Step 4: Run full `/srcla` verification**

Run: `cd srcla && pnpm test && pnpm exec tsc --noEmit && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/controller srcla/src/runtime/scheduler.ts srcla/src/http/routes.ts srcla/src/main.ts srcla/README.md
git commit -m "feat(srcla): run the hourly auditable controller"
```
