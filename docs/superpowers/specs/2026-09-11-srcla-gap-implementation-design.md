# SRCLA Gap Implementation Design

**Date:** 2026-09-11

**Status:** Draft

**Owner:** khoa

## 1. Overview and Goals

This spec covers closing the gaps between the SRCLA paper (v0.4, 2026-08-02) and the current implementation. The work is scoped to srcla/ (all algorithm, execution, keeper logic) and be/ (read-only proxy to frontend). Three priority tiers:

- **P0** — Prevents correct execution (algorithmic correctness, missing Merkle proof binding)
- **P1** — Production readiness (cold-start enforcement, evaluation accuracy, ablations)
- **P2** — Polish (B4 adapter registry, be/ proxy endpoints)

## 2. Architecture Boundaries

### 2.1 Component Ownership

| Component | Owner | Responsibility |
|---|---|---|
| srcla/ | SRCLA service | All algorithm, keeper execution, proposal generation, decision cycle |
| be/ | Backend proxy | Read-only: proxy srcla data to frontend; no keeper logic, no proposal building |
| contract/ | Immutable | No changes (already correct) |

### 2.2 Proposal Flow

```
Scheduler (hourly tick)
  └── Controller.run()
        └── DecisionEngine.buildPlan()
              └── PlanBuilder.buildPlan()
                    └── KeeperExecutor.executePlan()
                          ├── read vault.currentConfigurationDigest() [NEW]
                          ├── submitPlan(header, merkleRoot)
                          └── executeAction() × N
```

The keeper wallet and plan execution live entirely inside srcla/. be/ has no keeper key.

### 2.3 Files Touched

**srcla/ (all changes):**

| File | Change |
|---|---|
| `src/protocols/simulation/compound-simulator.ts` | Replace exp() model with kinked linear model matching Comet governance |
| `src/protocols/simulation/types.ts` | Add CompoundSimulatorConfig fields: `kink`, `slopeLow`, `slopeHigh` |
| `src/forecast/direct-arx.ts` | Replace `mean * 0.70` with calibrated quantile from walk-forward residuals |
| `src/evaluation/runner.ts` | Real CoverageTracker metrics, Sharpe from snapshots, H3/H5 ablation fixes, B4 adapter registry |
| `src/runtime/scheduler.ts` | Call `RegimeTracker.isEligible()` before generating deploy actions |
| `src/execution/keeper-executor.ts` | Read vault `currentConfigurationDigest()` before `submitPlan` |
| `src/execution/executor.ts` | Expose `getConfigurationDigest()` method |
| `src/evaluation/coverage-tracker.ts` | Expose MAE/RMSE/sharpness from forecast validation |
| `src/config.ts` | Add Comet governance params to SrclaConfig |

**be/ (proxy changes only):**

| File | Change |
|---|---|
| `src/vault/vault-admin.controller.ts` | `POST /v1/rebalance/trigger` → calls srcla trigger endpoint |
| `src/vault/vault.service.ts` | Proxy all strategy/decision/harvest/allocation from srcla API |

---

## 3. P0: Compound III Kinked Linear Rate Model

### 3.1 Background

Paper §6.4 specifies that Compound simulation "applies the live governance-configured kinked supply curve" [38], [43]. The current implementation uses an exponential model (`rate = baseRate + (peakRate - baseRate) * exp(-k * (1 - u))`), which is incorrect.

### 3.2 Official Compound III Rate Model

From docs.compound.finance/interest-rates/ (confirmed official documentation):

**Formula (per second, scaled WAD):**

```
If utilization ≤ kink:
  rate = baseRate + slopeLow × utilization

If utilization > kink:
  rate = baseRate + slopeLow × kink + slopeHigh × (utilization − kink)
```

Where:
- `baseRate` = `supplyPerSecondInterestRateBase` (WAD per second)
- `kink` = `supplyKink` (RAY, e.g., 0.80 RAY = 80%)
- `slopeLow` = `supplyPerSecondInterestRateSlopeLow` (WAD per second / RAY)
- `slopeHigh` = `supplyPerSecondInterestRateSlopeHigh` (WAD per second / RAY)

The Compound adapter reads `comet.getSupplyRate(util)` from on-chain, which uses these exact governance parameters.

### 3.3 Implementation

**New `CompoundSimulatorConfig` interface** (replace existing):

```typescript
interface CompoundSimulatorConfig {
  /** Annualized base rate at 0% utilization (WAD, e.g., 3e16 = 3%) */
  baseRate: bigint;
  /** Utilization kink point (RAY, e.g., 8e17 = 80%) */
  kink: bigint;
  /** Annualized slope below kink (WAD / RAY, e.g., 4e18 / 1e27 ≈ 0.000000032) */
  slopeLow: bigint;
  /** Annualized slope above kink (WAD / RAY) */
  slopeHigh: bigint;
}
```

**Config loading** (priority order):
1. Read from on-chain Comet via `IComet`-compatible RPC calls at startup
2. Fall back to Base USDC Comet governance defaults (annualized, converted to per-second):
   - `baseRate`: 3% APY
   - `kink`: 0.80 RAY (80%)
   - `slopeLow`: ~0.000000032 per second per RAY (≈ 1%/year at 80% util)
   - `slopeHigh`: ~0.000000300 per second per RAY (≈ 10%/year at 100% util)

**`calculateRateFromUtilization` implementation:**

```typescript
calculateRateFromUtilization(util: bigint, config: CompoundSimulatorConfig): bigint {
  const { baseRate, kink, slopeLow, slopeHigh } = config;

  // Convert annual rates to per-second rates for internal math
  const basePerSec = baseRate / SECONDS_PER_YEAR;
  const slopeLowPerSec = slopeLow / SECONDS_PER_YEAR;
  const slopeHighPerSec = slopeHigh / SECONDS_PER_YEAR;

  if (util <= kink) {
    // rate = base + slopeLow × util
    return basePerSec + (slopeLowPerSec * util) / RAY;
  } else {
    // rate = base + slopeLow × kink + slopeHigh × (util − kink)
    const low = slopeLowPerSec * kink;
    const high = slopeHighPerSec * (util - kink);
    return basePerSec + low / RAY + high / RAY;
  }
}
```

**Capacity calculation:**

```typescript
calculateEffectiveCapacity(cash: bigint, borrows: bigint, maxUtilization: bigint = RAY): bigint {
  if (maxUtilization === 0n) return 0n;
  const maxCash = (borrows * RAY) / maxUtilization;
  return maxCash > cash ? maxCash - cash : 0n;
}
```

### 3.4 Testing

- Unit test: verify `calculateRateFromUtilization` matches on-chain Comet values at known utilization points
- Fork test: compare simulator output against `comet.getSupplyRate(util)` at 0%, 50%, 80%, 90%, 100% utilization
- Regression: ensure pre-deposit and post-deposit rate ordering is preserved

---

## 4. P0: DirectARX Calibrated Lower Bound

### 4.1 Background

Paper §7.2 specifies that the lower prediction bound is "a calibrated lower quantile of walk-forward horizon residuals." The current implementation hard-codes `mean * 0.70` (line 47 of direct-arx.ts), which is arbitrary.

### 4.2 Fix

During walk-forward calibration, the system already tracks forecast residuals (actual return − predicted return). The fix:

1. Store residuals during `calculateLoss()` across all walk-forward windows
2. Compute the α-quantile (default: 10th percentile) of the residual distribution
3. `lowerReturn = meanForecast + quantileResidual`

```typescript
// During calibration, collect residuals
residuals: bigint[] = [];

forecast() {
  // ... existing forecast logic ...
  const lowerReturn = this.computeLowerBound(this.calibratedResiduals);
  return { lowerReturn, ... };
}

private computeLowerBound(residuals: bigint[]): bigint {
  if (residuals.length < 10) return WAD; // Fallback: no residual data
  const sorted = [...residuals].sort((a, b) => Number(a - b));
  const quantileIndex = Math.floor(sorted.length * 0.10); // 10th percentile
  const quantileResidual = sorted[quantileIndex] ?? 0n;
  return meanForecast + quantileResidual;
}
```

This makes the lower bound data-driven: if the forecast systematically underestimates returns by 0.5%, the bound shifts accordingly.

---

## 5. P0: Merkle Proof — configurationDigest Binding

### 5.1 Background

`NavyVaultSRCLA.submitPlan()` (line 640) verifies:
```solidity
if (header.configurationDigest != currentConfigurationDigest()) revert InvalidConfigurationDigest();
```

The current `KeeperExecutor.executePlan()` passes `ethers.ZeroHash` for `configurationDigest`, which will always revert on-chain.

### 5.2 Fix

Before submitting a plan, read the vault's current configuration digest:

```typescript
// In KeeperExecutor or PlanExecutor
async getConfigurationDigest(vaultAddress: string): Promise<string> {
  const configDigest = await this.vaultContract.currentConfigurationDigest();
  return configDigest;
}

// In executePlan(), before building header:
const configDigest = await this.getConfigurationDigest(this.vaultAddress);
const header = {
  ...
  configurationDigest: configDigest,  // Was: ethers.ZeroHash
};
```

The `PlanExecutor` already has a `vault` contract instance. Add a `getConfigurationDigest()` method to it.

---

## 6. P1: Cold-Start Gate Enforcement

### 6.1 Background

`RegimeTracker.isEligible()` exists but `Scheduler.runController()` does not call it. Markets may be allocated before cold-start completes.

### 6.2 Fix

In `Scheduler.runController()`:

```typescript
async runController() {
  const snapshot = await this.collector.getSnapshot();
  const regimeState = this.regimeTracker.getState();

  // Check cold-start eligibility for each market
  for (const market of snapshot.snapshots) {
    if (!this.regimeTracker.isEligible(market.marketId)) {
      // Apply cold-start constraints
      const capacityFactor = this.config.srcla.coldStartCapacityFactor;  // 0.5
      const reserveFactor = this.config.srcla.coldStartReserveFactor;     // 1.5
      // Reduce effective capacity, increase reserve requirement
      market.effectiveCap = market.effectiveCap * capacityFactor;
    }
  }

  const plan = await this.controller.run(snapshot, regimeState);
  // ...
}
```

The `AdmissionEngine` also needs the cold-start flag propagated from `RegimeTracker`.

---

## 7. P1: Evaluation Runner — Real Metrics

### 7.1 Forecast Metrics

**Current (stub):**
```typescript
mae: 0, rmse: 0, sharpness: 0
```

**Fix:** `CoverageTracker` already computes these. Expose them:

```typescript
// In coverage-tracker.ts
interface CoverageMetrics {
  coverage: number;  // Already exists
  mae: number;       // Add: mean absolute error
  rmse: number;      // Add: root mean squared error
  sharpness: number; // Add: average interval width
  pinballLoss: number;
}
```

### 7.2 Sharpe Ratio

**Current (stub):**
```typescript
sharpeRatio = realizedNetApy / 0.10  // Assumes 10% std dev
```

**Fix:** Compute from actual snapshot series:

```typescript
// From snapshots: [totalAssets at t0, t1, ..., tn]
const returns: number[] = [];
for (let i = 1; i < snapshots.length; i++) {
  const r = Number(snapshots[i].assets - snapshots[i-1].assets) / Number(snapshots[i-1].assets);
  returns.push(r);
}
const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
const stdDev = Math.sqrt(variance);
const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;
```

### 7.3 Evaluation Runner Integration

In `EvaluationRunner.run()`:

```typescript
// Instead of stub metrics:
const coverageMetrics = coverageTracker.calculateCoverage(marketId);
forecastMetrics.set(marketId, {
  coverage: coverageMetrics.coverage,
  mae: coverageMetrics.mae,
  rmse: coverageMetrics.rmse,
  sharpness: coverageMetrics.sharpness,
  pinballLoss: coverageMetrics.pinballLoss,
});
```

---

## 8. P1: Ablations H3 and H5

### 8.1 H3 — No Cost Gate

**Current:** H3 delegates to B2 (capacity-aware).

**Paper requirement:** H3 disables the cost gate from B2's decision logic.

**Fix:**

```typescript
// In runner.ts createAblationPolicy():
if (ablation.id === 'h3') {
  // B2 logic but skip cost gate check
  return (state, snapshot) => {
    // Same as B2: deploy to highest-rate market within capacity
    // BUT: skip cost gate check in action-decision.ts
    const actions = b2Logic(state, snapshot);
    // Override: no cost gate
    return this.applyNoCostGate(actions);
  };
}
```

The cleanest approach: pass a `disableCostGate: boolean` flag into the policy function, and `action-decision.ts` checks it.

### 8.2 H5 — No Uncertainty

**Current:** H5 delegates to B2.

**Paper requirement:** H5 removes uncertainty treatment — use mean forecast directly, no lower-bound discount.

**Fix:**

```typescript
if (ablation.id === 'h5') {
  // B2 logic but use mean forecast instead of lower bound
  return (state, snapshot) => {
    const meanForecast = computeMeanForecast(state, snapshot);
    // Sort by meanForecast instead of lowerReturn
    return deployToHighestMean(state, snapshot, meanForecast);
  };
}
```

---

## 9. P2: B4 Baseline — Adapter Address Registry

### 9.1 Current Issue

B4 hardcodes positional `markets[i]` indexing, which is non-deterministic across runs.

### 9.2 Fix

Use adapter address lookup from the manifest:

```typescript
if (baseline.id === 'b4') {
  return (state, snapshot) => {
    const actions: Action[] = [];
    const markets = snapshot.snapshots
      .filter(m => !m.paused && m.capBps > 0)
      .sort((a, b) => Number(b.supplyRateE18 - a.supplyRateE18));

    if (markets.length === 0) return actions;

    const totalToDeploy = state.idleBase;
    const amount1 = totalToDeploy * 40n / 100n;
    const amount2 = totalToDeploy * 40n / 100n;
    const amount3 = totalToDeploy * 20n / 100n;

    // Use adapter address (marketId) as stable key
    const targets = [
      { adapter: markets[0].marketId, amount: amount1 },
      { adapter: markets[1]?.marketId ?? markets[0].marketId, amount: amount2 },
      { adapter: markets[2]?.marketId ?? markets[0].marketId, amount: amount3 },
    ];

    for (const target of targets) {
      if (target.amount > 0n) {
        actions.push({ kind: 'deploy', adapter: target.adapter, amount: target.amount });
      }
    }
    return actions;
  };
}
```

---

## 10. P2: be/ Read-Only Proxy

### 10.1 Trigger Endpoint

Add to `vault-admin.controller.ts`:

```typescript
@Post('rebalance/trigger')
async triggerRebalance(@Body() body: { force?: boolean }) {
  // Call srcla internal trigger endpoint
  const response = await this.srclaClient.triggerRebalance(body.force ?? false);
  return response;
}
```

The srcla service exposes an internal `POST /internal/trigger` endpoint that invokes the scheduler manually.

### 10.2 Proxy Strategy Data

`VaultService` proxies all read endpoints from srcla:

```typescript
async getDecisions() {
  return this.http.get(`${this.srclaBaseUrl}/v1/decisions`);
}

async getHarvests() {
  return this.http.get(`${this.srclaBaseUrl}/v1/harvests`);
}

async getStrategy() {
  return this.http.get(`${this.srclaBaseUrl}/v1/allocation`);
}
```

Remove any remaining keeper/allocator key references from be/.

---

## 11. Dependencies

```
compound-simulator.ts → types.ts (new CompoundSimulatorConfig fields)
runner.ts → coverage-tracker.ts (real metrics), config.ts (ColdStart config)
scheduler.ts → regime-tracker.ts (isEligible), admission/engine.ts (cold-start flag)
keeper-executor.ts → executor.ts (getConfigurationDigest), vault contract
direct-arx.ts → no new dependencies
vault-admin.controller.ts → srcla client (internal trigger endpoint)
vault.service.ts → srcla HTTP API
```

---

## 12. No Changes Required

The following are already correctly implemented and do not need changes:

- **NavyVaultSRCLA.sol** — Merkle proofs, staged execution, reserve enforcement all correct
- **CompoundAdapter.sol** — Reads `comet.getSupplyRate()` directly from on-chain
- **MoonwellAdapter.sol** — Uses correct jump-rate model matching paper §6.5
- **AaveV3Adapter** — Uses correct kinked model matching paper §6.3
- **SrclaClient (be/)** — Already correct read-only proxy pattern
- **ProposalEvaluator** — Already implements all 4 policy checks correctly
- **CostGate** — All 11 components implemented correctly
- **Rebalancer ordering** — Divest → Harvest → Deploy → Emergency order correct
- **Proposal lifecycle** — PENDING → APPROVED → EXECUTED flow correct

---

## 13. Testing Strategy

| Change | Test Type | Key Assertion |
|---|---|---|
| Compound kinked model | Fork test | `simulator.rateAt(u)` matches `comet.getSupplyRate(u)` at u ∈ {0%, 50%, 80%, 90%, 100%} |
| DirectARX lower bound | Unit test | Lower bound ≤ mean forecast; bound tracks residual distribution |
| configurationDigest | Integration test | `submitPlan()` does not revert with real digest |
| Cold-start gate | Unit test | Ineligible market has reduced capacity and increased reserve |
| Evaluation metrics | Regression test | Sharpe, MAE, RMSE are non-zero on real data |
| H3 ablation | Unit test | H3 policy ignores cost gate check |
| H5 ablation | Unit test | H5 policy uses mean forecast, not lower bound |
| B4 baseline | Unit test | Adapter addresses stable across runs |
| be/ proxy | API test | All /v1/* endpoints return data from srcla |
