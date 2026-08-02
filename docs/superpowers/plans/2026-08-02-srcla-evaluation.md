# SRCLA Registered Evaluation Implementation Plan (Plan 7 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run the paper-authoritative B0–B5, H1–H5, walk-forward, stress, cost, cohort, and pinned Base-fork evaluation, producing a reproducible release report that fails closed when SRCLA does not outperform.

**Architecture:** Evaluation code lives in `/srcla` and reuses the same pure admission, simulator, forecast, reserve, optimizer, and cost modules as production. A time-ordered replay engine supplies identical information, latency, costs, candidate markets, and declared safety inputs to every baseline. Fork jobs validate executable mechanics and cost models; report generation consumes frozen database records and a manifest, never mutable dashboards.

**Tech Stack:** TypeScript/Jest, PostgreSQL, ethers, Foundry/Anvil, Markdown/CSV/JSON report outputs.

## Global Constraints

- Depends on Plans 1–6 and follows Section 11 of `docs/research/output/srcla-paper.md` exactly.
- Vault tiers are exactly 10,000; 100,000; 1,000,000; and 10,000,000 USDC.
- Baselines are exactly B0 idle, B1 highest displayed rate, B2 capacity-aware without uncertainty, B3 B2 plus cost threshold without full reserve/dependency policy, B4 fixed robust allocation, and B5 hindsight diagnostic upper bound.
- All policies receive the same snapshots, data availability, finality, execution delays, failed-transaction rules, costs, candidate set, and applicable comparison envelope.
- Random train/test splits, look-ahead labels, post-held-out retuning, and sequential contamination of counterfactual fork states are forbidden.
- B5 is diagnostic only and never counted as a deployable competitor.
- A negative or statistically indistinguishable result fails the release gate and remains in the report.
- Raw inputs, manifests, policy/model hashes, and result hashes are retained so a third party can reproduce every table.

---

### Task 1: Freeze the evaluation manifest and time-ordered dataset

**Files:**
- Create: `srcla/src/evaluation/manifest.ts`
- Create: `srcla/src/evaluation/dataset.ts`
- Create: `srcla/src/evaluation/dataset.spec.ts`
- Create: `srcla/config/evaluation-manifest.json`
- Create: `srcla/scripts/freeze-evaluation.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Produces: immutable `EvaluationManifest`, `EvaluationDataset`, `freezeEvaluation()`, and dataset content hash.

- [ ] **Step 1: Write freeze/no-look-ahead tests**

```typescript
it('orders by finalized block and excludes outcomes unavailable at each origin', () => {
  const data = buildDataset(rows, manifest);
  expect(data.origins.every((o) => o.labels.every((l) => l.availableAt <= o.timestamp))).toBe(true);
});

it('refuses a manifest change after its hash is attached to a run', async () => {
  await expect(repo.replaceManifest(run.id, changedManifest)).rejects.toThrow(/immutable/i);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- dataset`

Expected: FAIL because evaluation modules are absent.

- [ ] **Step 3: Implement exact manifest fields and frozen extraction**

```typescript
export interface EvaluationManifest {
  datasetFromBlock: number;
  datasetToBlock: number;
  calibrationEndBlock: number;
  heldOutStartBlock: number;
  vaultSizesBase: readonly [bigint, bigint, bigint, bigint];
  marketIds: readonly ['aave-v3-usdc', 'compound-v3-usdc', 'moonwell-usdc'];
  snapshotCadenceSeconds: 900;
  decisionCadenceSeconds: 3600;
  policyCandidateHash: string;
  codeCommit: string;
}
```

Set vault sizes to `10_000e6`, `100_000e6`, `1_000_000e6`, and `10_000_000e6`. The freeze script selects only complete finalized snapshots and writes the manifest/content hashes into `EvaluationRun` before replay.

Register `"evaluation:freeze": "node dist/scripts/freeze-evaluation.js"` in `package.json`.

- [ ] **Step 4: Run tests and freeze a fixture dataset**

Run: `cd srcla && pnpm test -- dataset && pnpm run evaluation:freeze -- --fixture`

Expected: PASS and a deterministic fixture dataset hash.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/manifest.ts srcla/src/evaluation/dataset.ts srcla/src/evaluation/dataset.spec.ts srcla/config/evaluation-manifest.json srcla/scripts/freeze-evaluation.ts srcla/package.json
git commit -m "feat(srcla): freeze registered evaluation dataset"
```

---

### Task 2: Implement ERC-4626 cohort and execution replay

**Files:**
- Create: `srcla/src/evaluation/replay/state.ts`
- Create: `srcla/src/evaluation/replay/erc4626.ts`
- Create: `srcla/src/evaluation/replay/execution.ts`
- Create: `srcla/src/evaluation/replay/replay.ts`
- Create: `srcla/src/evaluation/replay/replay.spec.ts`

**Interfaces:**
- Produces: `ReplayEngine.run(policy, dataset, vaultSize): ReplayResult` with share/NAV/cohort/action histories.

- [ ] **Step 1: Write cohort fairness, delay, and cost tests**

```typescript
it('mints a late depositor at prevailing NAV and gives no earlier base profit', () => {
  const state = replay(twoCohortFixture);
  expect(state.users.alice.profitBase).toBe(2_100e6);
  expect(state.users.bob.profitBase).toBe(1_100e6);
});

it('applies the same one-hour decision latency and failed attempt cost to every deployable policy', () => {
  expect(results.map((r) => r.executionLatencySeconds)).toEqual(results.map(() => 3600));
});
```

Cover deposits, withdrawals, share-price growth, recognized reward NAV, reward harvest realization, cash reserve, unavailable assets, partial staged plans, failed transactions, gas/L1 fee, swaps, slippage, and protocol interest integration across irregular timestamps.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- replay`

Expected: FAIL because replay engine is absent.

- [ ] **Step 3: Implement integer-only replay state transitions**

```typescript
export interface ReplayState {
  timestamp: number;
  idleBase: bigint;
  positionsBase: Record<string, bigint>;
  recognizedRewardsBase: bigint;
  recognizedLossesBase: bigint;
  shareSupplyBase: bigint;
  users: Record<string, CohortAccount>;
}
```

Use the same rounding direction as the Solidity vault. Apply each policy decision only after registered latency against the later execution state. Every counterfactual policy receives an independent copy of the same pre-state.

- [ ] **Step 4: Run replay/property tests**

Run: `cd srcla && pnpm test -- replay`

Expected: PASS; conservation holds within registered rounding dust and later cohorts cannot receive earlier recognized NAV.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/replay
git commit -m "feat(srcla): replay ERC4626 cohorts and execution"
```

---

### Task 3: Implement B0–B5 baselines with equal inputs

**Files:**
- Create: `srcla/src/evaluation/baselines/types.ts`
- Create: `srcla/src/evaluation/baselines/b0-idle.ts`
- Create: `srcla/src/evaluation/baselines/b1-highest-rate.ts`
- Create: `srcla/src/evaluation/baselines/b2-capacity.ts`
- Create: `srcla/src/evaluation/baselines/b3-capacity-cost.ts`
- Create: `srcla/src/evaluation/baselines/b4-fixed-robust.ts`
- Create: `srcla/src/evaluation/baselines/b5-hindsight.ts`
- Create: `srcla/src/evaluation/baselines/baselines.spec.ts`
- Create: `srcla/scripts/run-evaluation-fixture.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Every baseline implements `EvaluationPolicy.decide(origin): AllocationDecision`.

- [ ] **Step 1: Write defining-behavior and equal-information tests**

```typescript
it('B1 uses displayed rate and never post-deposit rate', () => {
  expect(b1.decide(origin).target.marketId).toBe('small-high-display-market');
});

it('B5 cannot read beyond the declared diagnostic horizon', () => {
  expect(() => b5.decide(originWithHiddenFuture)).not.toThrow();
  expect(originWithHiddenFuture.reads).toEqual(['diagnostic-horizon']);
});
```

Assert B0 remains idle, B2 uses post-deposit curves without uncertainty, B3 adds cost threshold but omits full dynamic reserve/dependency policy as specified, B4 uses one frozen robust allocation over the eligible set, and B5 is labeled non-deployable.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- baselines`

Expected: FAIL before baseline modules exist.

- [ ] **Step 3: Implement baselines through shared policy interfaces**

```typescript
export interface EvaluationPolicy {
  readonly id: 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'SRCLA';
  readonly deployable: boolean;
  decide(origin: EvaluationOrigin): AllocationDecision;
}
```

All deployable baselines use the same executor cost/delay/failure functions. Persist their raw decisions and reasons exactly like SRCLA.

Implement `run-evaluation-fixture.ts` for both policy and ablation fixture modes; register `"evaluation:fixture": "node dist/scripts/run-evaluation-fixture.js"`.

- [ ] **Step 4: Run baseline tests across four vault tiers**

Run: `cd srcla && pnpm test -- baselines && pnpm run evaluation:fixture -- --policies B0,B1,B2,B3,B4,B5 --sizes all`

Expected: PASS and deterministic result hashes per policy/tier.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/baselines srcla/scripts/run-evaluation-fixture.ts srcla/package.json
git commit -m "feat(srcla): implement registered B0 through B5 baselines"
```

---

### Task 4: Implement H1–H5 ablations and market regimes

**Files:**
- Create: `srcla/src/evaluation/ablations.ts`
- Create: `srcla/src/evaluation/regimes.ts`
- Create: `srcla/src/evaluation/ablations.spec.ts`
- Create: `srcla/config/stress-scenarios.json`

**Interfaces:**
- Produces single-component ablation policies and deterministic regime labels.

- [ ] **Step 1: Write one-component-only tests**

```typescript
it.each(['H1-capacity', 'H2-uncertainty', 'H3-cost', 'H4-liquidity', 'H5-dependency'])
('%s changes exactly one policy component', (id) => {
  expect(diffPolicy(srclaPolicy, ablation(id))).toHaveLength(1);
});
```

Test utilization/kink, reward-on/off, high/low volatility, liquidity stress, gas stress, governance/config change, and market-specific regime labels derived only from origin-visible data.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- ablations`

Expected: FAIL.

- [ ] **Step 3: Implement registered ablations and stress fixtures**

```typescript
export const ablations = {
  'H1-capacity': removeCapacitySimulation,
  'H2-uncertainty': replaceLowerBoundWithMean,
  'H3-cost': removeMoveCostGate,
  'H4-liquidity': replaceDynamicReserveWithFixedReserve,
  'H5-dependency': removeDependencyCaps,
} as const;
```

Each ablation holds every other component, dataset, latency, cost, and constraint constant. Stress scenarios include protocol cash contraction, withdrawals at calibrated quantiles, one-market pause, reward price gap, gas/L1 fee spike, stale oracle, and configuration quarantine.

- [ ] **Step 4: Run tests and fixture ablations**

Run: `cd srcla && pnpm test -- ablations && pnpm run evaluation:fixture -- --ablations all`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/ablations.ts srcla/src/evaluation/regimes.ts srcla/src/evaluation/ablations.spec.ts srcla/config/stress-scenarios.json
git commit -m "feat(srcla): add registered controller ablations and regimes"
```

---

### Task 5: Implement forecast, return, risk, liquidity, and policy metrics

**Files:**
- Create: `srcla/src/evaluation/metrics/forecast.ts`
- Create: `srcla/src/evaluation/metrics/returns.ts`
- Create: `srcla/src/evaluation/metrics/risk.ts`
- Create: `srcla/src/evaluation/metrics/liquidity.ts`
- Create: `srcla/src/evaluation/metrics/statistics.ts`
- Create: `srcla/src/evaluation/metrics/metrics.spec.ts`

**Interfaces:**
- Produces `EvaluationMetrics` and statistical comparison records used by the release report.

- [ ] **Step 1: Write known-vector metric tests**

```typescript
it('computes lower-bound exception rate and conditional shortfall', () => {
  expect(forecastMetrics([1n, -2n], [0n, 0n])).toMatchObject({ exceptions: 1, exceptionRateBps: 5000, maxShortfall: 2n });
});

it('reports net APY after gas and swap costs exactly once', () => {
  expect(netReturn({ gross: 100n, gas: 10n, swapImpactAlreadyInOutput: true })).toBe(90n);
});
```

Cover bias, MAE, RMSE, MASE, pinball loss, exception coverage/independence, shortfall, sharpness, net APY, share growth, cohort profit, gas, L1 fee, swap, turnover, reversals, drawdown, expected shortfall, withdrawal success, stressed coverage, unavailable assets, dependency concentration, and violations.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- metrics`

Expected: FAIL.

- [ ] **Step 3: Implement exact metrics and confidence outputs**

```typescript
export interface EvaluationMetrics {
  realizedNetApyE18: bigint;
  sharePriceGrowthE18: bigint;
  turnoverBase: bigint;
  reversalCount: number;
  withdrawalSuccessBps: number;
  stressedCoverageBps: number;
  maxDrawdownE18: bigint;
  expectedShortfallE18: bigint;
  policyViolationCount: number;
}
```

Use time-weighted annualization from actual elapsed seconds. Report effect sizes and uncertainty; do not convert “not significant” into “equal.” Account for overlapping horizon dependence in formal tests and also report non-overlapping calibration results.

- [ ] **Step 4: Run metrics and statistical fixture tests**

Run: `cd srcla && pnpm test -- metrics`

Expected: PASS against hand-calculated fixtures.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/metrics
git commit -m "feat(srcla): calculate registered evaluation metrics"
```

---

### Task 6: Add pinned Base-fork execution and full-cost replay jobs

**Files:**
- Create: `srcla/src/evaluation/fork/anvil.ts`
- Create: `srcla/src/evaluation/fork/runner.ts`
- Create: `srcla/src/evaluation/fork/costs.ts`
- Create: `srcla/src/evaluation/fork/runner.spec.ts`
- Create: `srcla/scripts/run-fork-replay.ts`
- Modify: `srcla/package.json`

**Interfaces:**
- Produces fork receipts, balance deltas, L2 execution fee, L1 data fee, quote/execution shortfall, and failure records keyed by policy/decision/block.

- [ ] **Step 1: Write independent-prestate and fee tests**

```typescript
it('reverts the fork snapshot before each counterfactual policy', async () => {
  await runner.runCandidates(block, [b1Tx, srclaTx]);
  expect(anvil.revertCalls).toBe(2);
});

it('records Base L1 data fee separately from L2 execution gas', () => {
  expect(costs.totalWei).toBe(costs.l1DataFeeWei + costs.l2ExecutionFeeWei);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- runner`

Expected: FAIL before fork runner exists.

- [ ] **Step 3: Implement pinned Anvil orchestration**

```typescript
const anvil = await startAnvil({ forkUrl: cfg.baseRpcUrl, forkBlockNumber: decision.blockNumber });
const snapshotId = await anvil.snapshot();
for (const candidate of candidates) {
  await anvil.revert(snapshotId);
  snapshotId = await anvil.snapshot();
  await executeAndRecord(candidate);
}
```

Use the Base GasPriceOracle behavior active at each historical block, serialize the same transaction shape, and convert ETH fees with preregistered historical ETH/USD and USDC/USD rounds. Store actual DEX output without subtracting embedded DEX impact twice.

Register `"evaluation:fork": "node dist/scripts/run-fork-replay.js"`.

- [ ] **Step 4: Run unit tests and one pinned fork replay**

Run: `cd srcla && pnpm test -- runner`

Run with RPC: `cd srcla && source .env && pnpm run evaluation:fork -- --fixture-block 49437605`

Expected: PASS and persisted receipt/cost/balance-delta hashes.

- [ ] **Step 5: Commit**

```bash
git add srcla/src/evaluation/fork srcla/scripts/run-fork-replay.ts srcla/package.json
git commit -m "feat(srcla): replay decisions on pinned Base forks"
```

---

### Task 7: Generate the release report and enforce the research gate

**Files:**
- Create: `srcla/src/evaluation/report/report.ts`
- Create: `srcla/src/evaluation/report/tables.ts`
- Create: `srcla/src/evaluation/report/release-gate.ts`
- Create: `srcla/src/evaluation/report/release-gate.spec.ts`
- Create: `srcla/scripts/run-evaluation.ts`
- Create: `srcla/scripts/verify-evaluation.ts`
- Modify: `srcla/package.json`
- Generate: `docs/research/output/srcla-evaluation-report.md`
- Generate: `docs/research/output/srcla-evaluation-results.csv`
- Generate: `docs/research/output/srcla-evaluation-manifest.json`
- Modify: `srcla/README.md`

**Interfaces:**
- Produces one immutable evaluation run and explicit `PASS` or `FAIL` release result.

- [ ] **Step 1: Write fail-closed gate tests**

```typescript
it('fails on any safety violation', () => {
  expect(releaseGate(result({ policyViolationCount: 1 }))).toEqual(expect.objectContaining({ status: 'FAIL' }));
});

it('fails when simpler baselines are statistically indistinguishable after cost', () => {
  expect(releaseGate(indistinguishableFixture)).toEqual(expect.objectContaining({ status: 'FAIL' }));
});
```

Also fail on missing tier/regime/baseline/ablation/fork results, calibration coverage failure, manifest mismatch, incomplete costs, and non-reproducible rerun hash.

- [ ] **Step 2: Run and confirm failure**

Run: `cd srcla && pnpm test -- release-gate`

Expected: FAIL before report/gate modules exist.

- [ ] **Step 3: Implement complete reporting and immutable run finalization**

```typescript
export function releaseGate(input: CompleteEvaluation): ReleaseDecision {
  const reasons = collectGateFailures(input);
  return { status: reasons.length === 0 ? 'PASS' : 'FAIL', reasons: reasons.sort() };
}
```

The Markdown report states empirical limits, publishes every required metric by policy/tier/regime, labels B5 diagnostic, reports H1–H5, includes negative findings, and links hashes for raw snapshots, manifest, code, policy, model, decisions, fork receipts, CSV, and rerun.

Register `"evaluation:run": "node dist/scripts/run-evaluation.js"` and `"evaluation:verify": "node dist/scripts/verify-evaluation.js"`.

- [ ] **Step 4: Run complete verification and reproduce twice**

Run:

```bash
cd srcla
pnpm test
pnpm exec tsc --noEmit
pnpm build
source .env
pnpm run evaluation:run -- --manifest config/evaluation-manifest.json
pnpm run evaluation:verify -- --latest-complete
```

Expected: the verification run reproduces the same result hash. Release status may honestly be `PASS` or `FAIL`; the command succeeds when reproduction is valid, not only when outperformance passes.

- [ ] **Step 5: Commit the harness and frozen result artifacts**

```bash
git add srcla/src/evaluation/report srcla/scripts/run-evaluation.ts srcla/scripts/verify-evaluation.ts srcla/package.json srcla/README.md docs/research/output/srcla-evaluation-report.md docs/research/output/srcla-evaluation-results.csv docs/research/output/srcla-evaluation-manifest.json
git commit -m "research: publish registered SRCLA evaluation"
```
